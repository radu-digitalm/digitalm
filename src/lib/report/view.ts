// Server side of /r/[token]: load a report by token, decide whether a request
// counts as a view, and log it (contract §8). Views are logged only once the
// report has been sent (report_expires_at set), never for bots, admin
// sessions, prefetches or non-document fetches, and the activity payload holds
// an IP hash only. Telegram and Umami get references, nothing else.
import { createHash } from "node:crypto";
import type { Audit, AuditChecks, CheckKey, FitSuggestion, Flag, PsiSummary } from "@/lib/crm/types";
import { readSession } from "@/lib/crm/auth";
import { fromSql, parseJson } from "@/lib/crm/db";
import { enquiriesDb } from "@/lib/enquiries";
import { notifyTelegram } from "@/lib/notify";
import { SITE_URL } from "@/lib/seo";
import { serverTrack } from "@/lib/serverTrack";
import { safeDisplayName } from "@/lib/drafts/templates";
import type { ReportLocale } from "@/content/report";
import { tradeWords } from "./findings";

/** 32 random bytes as base64url — the shape of every report_token (crm/refs.ts note in §2). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function reportUrl(token: string): string {
  return `${SITE_URL}/r/${token}`;
}

/** Same expression outreach's legal.ts publishes; kept local so report ships first (merge order §14). */
export function privacyUrl(locale: ReportLocale): string {
  return `${SITE_URL}/${locale}/legal/confidentialite`;
}

/** REPORT_TTL_DAYS (default 90) — outreach adds it to `now` at the first send. */
export function reportTtlDays(): number {
  const n = Number.parseInt(process.env.REPORT_TTL_DAYS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

// ---- rows -------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function rowToAudit(r: Row): Audit {
  const status = str(r.status);
  const grade = str(r.grade);
  return {
    id: Number(r.id),
    reference: String(r.reference),
    prospectId: Number(r.prospect_id),
    status: status === "queued" || status === "running" || status === "done" || status === "failed" ? status : "failed",
    locale: r.locale === "fr" ? "fr" : "en",
    website: str(r.website),
    checks: parseJson<AuditChecks | null>(str(r.checks), null),
    score: num(r.score),
    grade: grade === "A" || grade === "B" || grade === "C" ? grade : null,
    flags: parseJson<Flag[]>(str(r.flags), []),
    fits: parseJson<FitSuggestion[]>(str(r.fits), []),
    top: parseJson<CheckKey[]>(str(r.top), []),
    pagespeed: parseJson<PsiSummary | null>(str(r.pagespeed), null),
    crawl: parseJson<Audit["crawl"]>(str(r.crawl), []),
    reportToken: String(r.report_token ?? ""),
    reportExpiresAt: str(r.report_expires_at),
    reportFirstViewedAt: str(r.report_first_viewed_at),
    reportViews: Number(r.report_views ?? 0),
    error: str(r.error),
    startedAt: str(r.started_at),
    finishedAt: str(r.finished_at),
    createdAt: String(r.created_at ?? ""),
  };
}

// ---- load ---------------------------------------------------------------------------

export interface ReportData {
  audit: Audit;
  locale: ReportLocale;
  /** safeDisplayName() — never a sole trader's personal name. */
  business: string;
  town: string | null;
  trade: string | null;
  /** The site that was checked (audit.website, else the prospect's current one); raw — render through safeHttpUrl. */
  website: string | null;
  prospectId: number;
  prospectReference: string;
  leadId: number | null;
  expired: boolean;
}

/**
 * The report behind a token: a finished audit of a live prospect, or null
 * (unknown token, wrong shape, audit not done, prospect deleted) → 404.
 */
export function loadReport(token: string, now = new Date()): ReportData | null {
  if (!TOKEN_RE.test(token)) return null;
  const row = enquiriesDb()
    .prepare(
      `SELECT a.*, p.name AS p_name, p.legal_name AS p_legal_name, p.enseigne AS p_enseigne, p.sole_trader AS p_sole_trader,
              p.city AS p_city, p.trade_key AS p_trade_key, p.website AS p_website, p.reference AS p_reference,
              p.lead_id AS p_lead_id, p.deleted_at AS p_deleted_at
         FROM audits a JOIN prospects p ON p.id = a.prospect_id
        WHERE a.report_token = ?`,
    )
    .get(token) as Row | undefined;
  if (!row || row.p_deleted_at) return null;
  const audit = rowToAudit(row);
  if (audit.status !== "done") return null;
  const locale = audit.locale;
  const expiresAt = fromSql(audit.reportExpiresAt);
  return {
    audit,
    locale,
    business: safeDisplayName(
      { enseigne: str(row.p_enseigne), legalName: str(row.p_legal_name), name: str(row.p_name), soleTrader: row.p_sole_trader === null ? null : Number(row.p_sole_trader) === 1 },
      locale,
    ),
    town: str(row.p_city),
    trade: tradeWords(str(row.p_trade_key), locale),
    website: audit.website ?? str(row.p_website),
    prospectId: audit.prospectId,
    prospectReference: String(row.p_reference ?? ""),
    leadId: num(row.p_lead_id),
    expired: expiresAt !== null && expiresAt.getTime() < now.getTime(),
  };
}

// ---- view logging -----------------------------------------------------------------------

const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|Slackbot|WhatsApp|TelegramBot/i;

/**
 * True when a request is a real person opening the page: not a bot UA, not an
 * admin session, not a prefetch, and a top-level document fetch. `get` is the
 * request headers' getter (next/headers `headers()` or a Request).
 */
export function shouldLogView(get: (name: string) => string | null, adminCookie?: string | null): boolean {
  if (BOT_UA.test(get("user-agent") ?? "")) return false;
  if (adminCookie && readSession(adminCookie)) return false;
  if (get("next-router-prefetch") !== null) return false;
  if ((get("purpose") ?? "").toLowerCase() === "prefetch") return false;
  if ((get("sec-purpose") ?? "").toLowerCase().includes("prefetch")) return false;
  const dest = get("sec-fetch-dest");
  if (dest !== null && dest.toLowerCase() !== "document") return false;
  return true;
}

/** Same rule as clientIp() in lib/rateLimit, for a headers getter instead of a Request. */
export function ipFromHeaders(get: (name: string) => string | null): string {
  const real = get("x-real-ip");
  if (real) return real.trim();
  const xff = get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",");
    return hops[hops.length - 1]!.trim();
  }
  return "unknown";
}

/** Salted so the stored hash cannot be walked back over the IPv4 space. */
export function ipHash(ip: string): string {
  return createHash("sha256").update(`report-view|${process.env.ADMIN_SESSION_SECRET ?? ""}|${ip}`).digest("hex");
}

/**
 * Count a view: report_views++, report_first_viewed_at once, a report_view
 * activity on the prospect (and its lead), an Umami event with the reference,
 * a Telegram ping on the first view. Callers check shouldLogView() and that
 * report_expires_at is set. Never throws.
 */
export function logView(report: ReportData, ip: string): void {
  try {
    const db = enquiriesDb();
    const ref = report.audit.reference;
    const first = db.transaction(() => {
      const before = db.prepare("SELECT report_first_viewed_at FROM audits WHERE id = ?").get(report.audit.id) as { report_first_viewed_at: string | null } | undefined;
      if (!before) return false;
      db.prepare(
        "UPDATE audits SET report_views = report_views + 1, report_first_viewed_at = COALESCE(report_first_viewed_at, datetime('now')) WHERE id = ?",
      ).run(report.audit.id);
      db.prepare(
        "INSERT INTO activities (lead_id, prospect_id, kind, channel, summary, payload, actor) VALUES (?, ?, 'report_view', 'web', ?, ?, 'prospect')",
      ).run(report.leadId, report.prospectId, `Report ${ref} opened`, JSON.stringify({ ipHash: ipHash(ip), reference: ref }));
      if (report.leadId !== null) {
        db.prepare("UPDATE leads SET last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(report.leadId);
      }
      return before.report_first_viewed_at === null;
    })();
    serverTrack("report_view", { ref });
    if (first) notifyTelegram(`👀 Report ${ref} opened for the first time (${report.prospectReference})`);
  } catch (e) {
    console.error("report view logging failed", (e as { code?: string }).code ?? (e as Error).message);
  }
}
