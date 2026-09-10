// Today (contract §5): the numbers behind /admin and the 08:00 digest.
// `collectToday()` gathers them with raw SQL (no imports from lib/prospects or
// lib/outreach — READY_WHERE, CALL_WHERE and outreachDailyCap() come from
// crm/db.ts); `summariseToday()` turns them into cards and is pure, so
// node --test can load this file: the DB helpers are imported lazily inside
// collectToday() only. scripts/digitalm-digest.js mirrors the same queries in
// plain JS for the read-only Telegram digest — keep the two in step.
import type { LeadStage } from "../crm/types.ts";
import { OUTREACH_MODULE } from "../crm/features.ts";
import { daysSince, daysUntil, type Tone } from "./stages.ts";

export interface FollowUp {
  id: number;
  reference: string;
  name: string | null;
  company: string | null;
  stage: LeadStage;
  nextAction: string | null;
  nextActionAt: string; // YYYY-MM-DD
}

export interface OpenedReport {
  prospectId: number;
  prospectReference: string;
  name: string;
  auditReference: string;
  firstViewedAt: string;
  views: number;
}

export interface TodayData {
  today: string; // YYYY-MM-DD, Europe/Paris
  followUps: FollowUp[]; // open leads with next_action_at <= today
  newLeads7d: { label: string; n: number }[];
  reportsOpenedNoReply: OpenedReport[];
  emailsToday: number;
  emailCap: number;
  audits: { queued: number; running: number; failed7d: number };
  ready: number;
  call: number;
  googleMonth: number;
  googleCap: number;
  noticeDeadlines5d: number;
  bounces7d: number;
  sends30d: number;
  purgeLastRunAt: string | null;
  backfillPending: number;
}

export interface TodayCard {
  key: string;
  title: string;
  value: string;
  detail?: string;
  tone: Tone;
  href?: string;
  lines?: { text: string; href?: string }[];
}

/** Purge is "stale" after this many days without a run (contract: older than 2 days or missing → red). */
export const PURGE_STALE_DAYS = 2;

export function purgeAgeDays(lastRunAt: string | null, now: Date): number | null {
  return daysSince(lastRunAt, now);
}

/** Missing, unreadable, or more than 48 h old (two missed 04:00 runs) — the red card. */
export function purgeIsStale(lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return true;
  const ms = Date.parse(`${lastRunAt.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return true;
  return now.getTime() - ms > PURGE_STALE_DAYS * 86_400_000;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function followUpLine(f: FollowUp, today: string): { text: string; href: string } {
  const days = daysUntil(f.nextActionAt, today);
  const when = days === 0 ? "today" : days === -1 ? "1 day overdue" : `${-days} days overdue`;
  const who = [f.name, f.company].filter(Boolean).join(" · ") || f.reference;
  return { text: `${f.reference} · ${who} — ${f.nextAction ?? "follow up"} (${when})`, href: `/admin/leads/${f.id}` };
}

/** Cards for /admin, in display order. Pure: same input, same cards. */
export function summariseToday(d: TodayData, now = new Date()): TodayCard[] {
  const cards: TodayCard[] = [];

  const overdue = d.followUps.filter((f) => daysUntil(f.nextActionAt, d.today) < 0).length;
  const due = d.followUps.length - overdue;
  cards.push({
    key: "followups",
    title: "Follow-ups",
    value: `${due} due · ${overdue} overdue`,
    tone: overdue > 0 ? "bad" : due > 0 ? "warn" : "neutral",
    href: "/admin/leads?stage=open&sort=next&dir=asc",
    lines: d.followUps.slice(0, 8).map((f) => followUpLine(f, d.today)),
  });

  const newTotal = d.newLeads7d.reduce((s, r) => s + r.n, 0);
  cards.push({
    key: "new-leads",
    title: "New leads, 7 days",
    value: String(newTotal),
    tone: newTotal > 0 ? "info" : "neutral",
    href: "/admin/leads?stage=all&sort=created&dir=desc",
    lines: d.newLeads7d.map((r) => ({ text: `${r.label}: ${r.n}` })),
  });

  cards.push({
    key: "reports-opened",
    title: "Reports opened, no reply",
    value: String(d.reportsOpenedNoReply.length),
    tone: d.reportsOpenedNoReply.length > 0 ? "warn" : "neutral",
    lines: d.reportsOpenedNoReply.slice(0, 8).map((r) => ({
      text: `${r.prospectReference} · ${r.name} — ${r.auditReference}, ${plural(r.views, "view")}`,
      href: `/admin/prospects/${r.prospectId}`,
    })),
  });

  cards.push({
    key: "emails-today",
    title: "Emails sent today",
    value: `${d.emailsToday} / ${d.emailCap}`,
    tone: d.emailsToday >= d.emailCap ? "warn" : d.emailsToday > 0 ? "good" : "neutral",
    detail: d.emailsToday >= d.emailCap ? "Daily cap reached" : undefined,
  });

  cards.push({
    key: "audits",
    title: "Audits",
    value: `${d.audits.queued} queued · ${d.audits.running} running`,
    detail: `${d.audits.failed7d} failed in 7 days`,
    tone: d.audits.failed7d > 0 ? "bad" : d.audits.queued + d.audits.running > 0 ? "info" : "neutral",
  });

  cards.push({
    key: "ready",
    title: "Ready to send",
    value: String(d.ready),
    tone: d.ready > 0 ? "good" : "neutral",
    href: "/admin/prospects?view=ready",
  });

  cards.push({
    key: "call",
    title: "Call list",
    value: String(d.call),
    tone: d.call > 0 ? "info" : "neutral",
    href: "/admin/prospects?view=call",
  });

  cards.push({
    key: "google",
    title: "Google calls this month",
    value: `${d.googleMonth} / ${d.googleCap}`,
    tone: d.googleMonth >= d.googleCap ? "bad" : d.googleMonth >= d.googleCap * 0.9 ? "warn" : "neutral",
  });

  cards.push({
    key: "notice-deadlines",
    title: "Notice deadlines within 5 days",
    value: String(d.noticeDeadlines5d),
    tone: d.noticeDeadlines5d > 0 ? "warn" : "neutral",
    detail: d.noticeDeadlines5d > 0 ? "Send the notice or the purge wipes them" : undefined,
    href: "/admin/prospects",
  });

  cards.push({
    key: "bounces",
    title: "Bounces this week",
    value: String(d.bounces7d),
    tone: d.bounces7d > 0 ? "warn" : "neutral",
  });

  cards.push({
    key: "stop-replies",
    title: "STOP replies: check the mailbox",
    value: `${plural(d.sends30d, "email")} in 30 days`,
    detail: d.sends30d > 0 ? "Record any STOP reply on the opt-out list" : OUTREACH_MODULE ? "Nothing sent recently" : "Nothing sent — the opt-out list arrives with the outreach module",
    tone: d.sends30d > 0 ? "info" : "neutral",
    ...(OUTREACH_MODULE ? { href: "/admin/optouts" } : {}),
  });

  const age = purgeAgeDays(d.purgeLastRunAt, now);
  cards.push({
    key: "purge",
    title: "Purge last ran",
    value: age === null ? "never" : age === 0 ? "today" : `${plural(age, "day")} ago`,
    tone: purgeIsStale(d.purgeLastRunAt, now) ? "bad" : "good",
    detail: purgeIsStale(d.purgeLastRunAt, now) ? "Retention depends on the daily purge — check the scheduler" : undefined,
  });

  if (d.backfillPending > 0) {
    cards.push({
      key: "backfill",
      title: "Enquiries not yet in Leads",
      value: String(d.backfillPending),
      tone: "warn",
      detail: "Run the backfill once; it is idempotent",
    });
  }

  return cards;
}

/** Plain-text rendering of the cards (the digest script has its own copy in JS). */
export function formatTodayText(cards: TodayCard[]): string {
  const out: string[] = [];
  for (const c of cards) {
    out.push(`${c.title}: ${c.value}${c.detail ? ` — ${c.detail}` : ""}`);
    for (const l of c.lines ?? []) out.push(`  · ${l.text}`);
  }
  return out.join("\n");
}

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Gathers every Today number from the DB. Async only because the DB helpers load lazily. */
export async function collectToday(now = new Date()): Promise<TodayData> {
  const { enquiriesDb } = await import("@/lib/enquiries");
  const { CALL_WHERE, READY_WHERE, outreachDailyCap, outreachSentToday, zonedToday } = await import("@/lib/crm/db");
  const db = enquiriesDb();
  const [y, m, d] = zonedToday("Europe/Paris", now);
  const today = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const month = today.slice(0, 7);
  const count = (sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...params) as { n: number }).n;

  const followUps = db
    .prepare(
      `SELECT id, reference, name, company, stage, next_action AS nextAction, next_action_at AS nextActionAt
       FROM leads
       WHERE next_action_at IS NOT NULL AND next_action_at <= ? AND stage NOT IN ('won', 'lost', 'no_response', 'stop')
       ORDER BY next_action_at, id LIMIT 50`,
    )
    .all(today) as FollowUp[];

  const newLeads7d = db
    .prepare(
      `SELECT COALESCE(source_label, 'Direct') AS label, COUNT(*) AS n
       FROM leads WHERE created_at > datetime('now', '-7 days')
       GROUP BY label ORDER BY n DESC, label`,
    )
    .all() as { label: string; n: number }[];

  const reportsOpenedNoReply = db
    .prepare(
      `SELECT p.id AS prospectId, p.reference AS prospectReference, p.name AS name, a.reference AS auditReference,
              a.report_first_viewed_at AS firstViewedAt, a.report_views AS views
       FROM audits a
       JOIN prospects p ON p.id = a.prospect_id
       LEFT JOIN leads l ON l.id = p.lead_id
       WHERE a.report_first_viewed_at IS NOT NULL AND p.deleted_at IS NULL
         AND (l.id IS NULL OR (l.replied_at IS NULL AND l.stage IN ('new', 'contacted')))
       ORDER BY a.report_first_viewed_at DESC LIMIT 50`,
    )
    .all() as OpenedReport[];

  const jobCounts = { queued: 0, running: 0 };
  for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM jobs WHERE kind = 'audit' AND status IN ('queued', 'running') GROUP BY status`).all() as { status: string; n: number }[]) {
    if (r.status === "queued" || r.status === "running") jobCounts[r.status] = r.n;
  }

  return {
    today,
    followUps,
    newLeads7d,
    reportsOpenedNoReply,
    emailsToday: outreachSentToday(),
    emailCap: outreachDailyCap(),
    audits: {
      ...jobCounts,
      failed7d: count(`SELECT COUNT(*) AS n FROM audits WHERE status = 'failed' AND created_at > datetime('now', '-7 days')`),
    },
    ready: count(`SELECT COUNT(*) AS n FROM prospects WHERE ${READY_WHERE}`),
    call: count(`SELECT COUNT(*) AS n FROM prospects WHERE ${CALL_WHERE}`),
    googleMonth: count(`SELECT COALESCE(SUM(count), 0) AS n FROM api_usage WHERE provider = 'google_places' AND day LIKE ? ESCAPE '\\'`, `${month}-%`),
    googleCap: intEnv("GOOGLE_PLACES_MONTHLY_CAP", 900),
    noticeDeadlines5d: count(
      `SELECT COUNT(*) AS n FROM prospects
       WHERE deleted_at IS NULL AND notice_sent_at IS NULL AND personal_wiped_at IS NULL
         AND notice_deadline_at >= datetime('now') AND notice_deadline_at <= datetime('now', '+5 days')`,
    ),
    bounces7d: count(`SELECT COUNT(*) AS n FROM activities WHERE kind = 'bounce' AND created_at > datetime('now', '-7 days')`),
    sends30d: count(`SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND channel IN ('email', 'manual_email') AND sent_at > datetime('now', '-30 days')`),
    purgeLastRunAt: (db.prepare(`SELECT value FROM settings WHERE key = 'purge_last_run_at'`).get() as { value: string | null } | undefined)?.value ?? null,
    backfillPending: count(`SELECT COUNT(*) AS n FROM enquiries WHERE lead_id IS NULL`),
  };
}
