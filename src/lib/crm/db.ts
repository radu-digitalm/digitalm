// Shared CRM DB helpers: SQL timestamps, Europe/Paris day boundaries, the
// READY_WHERE / CALL_WHERE predicates used by finder's views and inbox's Today,
// the outreach daily cap and the settings table. Nothing here touches the DB at
// module load — every query lives inside a function.
import { enquiriesDb } from "@/lib/enquiries";

// ---- timestamps ----------------------------------------------------------
// Every CRM timestamp is stored the way SQLite's datetime('now') writes it —
// "YYYY-MM-DD HH:MM:SS" in UTC — so string comparisons in SQL stay correct.

export function toSql(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function sqlNow(): string {
  return toSql(new Date());
}

export function fromSql(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Offset of `tz` from UTC, in minutes, at the given instant. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant at which the wall clock in `tz` reads y-m-d h:mi. */
export function zonedDate(tz: string, y: number, m: number, d: number, h = 0, mi = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = tzOffsetMinutes(tz, new Date(guess));
  let result = guess - off * 60_000;
  // One more pass for the DST edges, where the first guess lands on the wrong side.
  off = tzOffsetMinutes(tz, new Date(result));
  result = guess - off * 60_000;
  return new Date(result);
}

/** Today's civil date in `tz` as [y, m, d]. */
export function zonedToday(tz: string, at = new Date()): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return [get("year"), get("month"), get("day")];
}

/** Start of today, Europe/Paris, as a SQL timestamp (used by the daily send cap). */
export function parisDayStartSql(at = new Date()): string {
  const [y, m, d] = zonedToday("Europe/Paris", at);
  return toSql(zonedDate("Europe/Paris", y, m, d));
}

/** Next occurrence of hh:mm Europe/Paris strictly after `at` (audit cap reschedule). */
export function nextParisTime(hour: number, minute = 0, at = new Date()): Date {
  const [y, m, d] = zonedToday("Europe/Paris", at);
  const today = zonedDate("Europe/Paris", y, m, d, hour, minute);
  if (today.getTime() > at.getTime()) return today;
  return zonedDate("Europe/Paris", y, m, d + 1, hour, minute);
}

// ---- countries and views ----------------------------------------------------

// Countries whose SendRule (outreach/rules.ts) allows in-app email. Mirrored
// here because these predicates ship before outreach lands (merge order §14);
// the env list can only restrict, never extend, exactly like emailEnabled().
const EMAIL_RULE_COUNTRIES = ["FR", "GB", "US"] as const;

/** ISO2 list from OUTREACH_COUNTRY_ALLOW ∩ rule countries — validated, safe to inline. */
export function emailEnabledCountries(): string[] {
  const raw = process.env.OUTREACH_COUNTRY_ALLOW ?? "FR,GB,US";
  const allow = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s)),
  );
  return EMAIL_RULE_COUNTRIES.filter((cc) => allow.has(cc));
}

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Prospects with latest_score below this appear in the "ready to send" view. */
export const READY_SCORE_MAX = intEnv("READY_SCORE_MAX", 60);

const COUNTRY_LIST = emailEnabledCountries().map((cc) => `'${cc}'`).join(",");

const USABLE_EMAIL = `(prospects.contact_email_override IS NOT NULL OR (prospects.website_email IS NOT NULL AND COALESCE(prospects.website_email_kind, 'unknown') NOT IN ('webmail', 'unknown')))`;

const HAS_PHONE = `(prospects.contact_phone_override IS NOT NULL OR prospects.website_phone IS NOT NULL OR prospects.source_phone IS NOT NULL)`;

const LEAD_OPEN = `NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = prospects.lead_id AND l.stage IN ('replied', 'meeting', 'proposal', 'won', 'lost', 'stop'))`;

// Art. 14 one-month rule: contact is allowed only while the notice deadline
// is ahead, once a notice went out, or once the personal fields were wiped.
const NOTICE_OK = `(prospects.notice_sent_at IS NOT NULL OR prospects.notice_deadline_at > datetime('now') OR prospects.personal_wiped_at IS NOT NULL)`;

/**
 * WHERE predicate (on the unaliased `prospects` table) for the "ready to send"
 * view — contract §6 Views. Callers add ORDER BY latest_score LIMIT 20.
 */
export const READY_WHERE = [
  `prospects.deleted_at IS NULL`,
  `prospects.fit <> 'not_fit'`,
  `prospects.opted_out_at IS NULL`,
  `prospects.diffusion <> 'partial'`,
  `prospects.latest_audit_id IS NOT NULL`,
  `prospects.latest_score < ${READY_SCORE_MAX}`,
  `EXISTS (SELECT 1 FROM audits a WHERE a.id = prospects.latest_audit_id AND a.finished_at > datetime('now', '-90 days'))`,
  `(prospects.last_emailed_at IS NULL OR prospects.last_emailed_at < datetime('now', '-90 days'))`,
  NOTICE_OK,
  USABLE_EMAIL,
  `prospects.forbids_extraction = 0`,
  `prospects.country IN (${COUNTRY_LIST})`,
  `prospects.register_status <> 'ceased'`,
  `(prospects.country <> 'GB' OR (prospects.sole_trader = 0 AND prospects.register_id IS NOT NULL))`,
  LEAD_OPEN,
].join("\n  AND ");

/**
 * WHERE predicate for the call list: no usable email, a phone on file, fewer
 * than 4 call attempts in 30 days, same opt-out / register / lead-stage /
 * notice-deadline exclusions, and no site that forbids extraction unless the
 * override reason is recorded. Every SendRule allows calls in some form
 * (true|screened|manual), so there is no country clause here.
 */
export const CALL_WHERE = [
  `prospects.deleted_at IS NULL`,
  `prospects.fit <> 'not_fit'`,
  `prospects.opted_out_at IS NULL`,
  `prospects.diffusion <> 'partial'`,
  `prospects.register_status <> 'ceased'`,
  NOTICE_OK,
  `(prospects.forbids_extraction = 0 OR prospects.forbids_override_reason IS NOT NULL)`,
  `NOT ${USABLE_EMAIL}`,
  HAS_PHONE,
  `(SELECT COUNT(*) FROM activities ac WHERE ac.prospect_id = prospects.id AND ac.kind = 'call' AND ac.created_at > datetime('now', '-30 days')) < 4`,
  LEAD_OPEN,
].join("\n  AND ");

// ---- settings and caps -----------------------------------------------------

export function getSetting(key: string): string | null {
  const row = enquiriesDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  enquiriesDb()
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .run(key, value);
}

/** OUTREACH_DAILY_CAP (default 10); settings.outreach_daily_cap_override can only lower it. */
export function outreachDailyCap(): number {
  const cap = intEnv("OUTREACH_DAILY_CAP", 10);
  const override = Number.parseInt(getSetting("outreach_daily_cap_override") ?? "", 10);
  return Number.isFinite(override) && override >= 0 && override < cap ? override : cap;
}

/** In-app emails sent since 00:00 Europe/Paris (status 'sent', channel 'email'). */
export function outreachSentToday(): number {
  const row = enquiriesDb()
    .prepare("SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND channel = 'email' AND sent_at >= ?")
    .get(parisDayStartSql()) as { n: number };
  return row.n;
}

/** JSON column reader that never throws. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
