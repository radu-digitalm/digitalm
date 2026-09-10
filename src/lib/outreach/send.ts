// Send engine (contract §9 "Send" and "Manual send"): gathers the facts for
// one prospect, runs the refusal engine, writes the `sends` row BEFORE any
// SMTP traffic, sends once (attempts: 1 — a manual send has a human waiting
// behind nginx's read timeout) and applies the prospect / lead / audit updates
// on success. The manual path prepares the same row with channel
// `manual_email` and the legal block resolved, then records it as sent once
// the owner confirms he pasted it into Gmail. A `pending` row is a
// reservation: it counts towards the daily cap and the 90-day counters and
// refuses a second send to the same prospect until it is sent, recorded or
// cancelled — better-sqlite3 is synchronous, so the facts and the insert of
// one request run without a yield and two requests cannot both pass. Nothing
// touches the DB at module load; bodies are never logged.
import { countApiUsage } from "@/lib/crm/apiUsage";
import { classifyEmail, hashEmail, validEmail } from "@/lib/crm/classify";
import { outreachDailyCap } from "@/lib/crm/db";
import { HttpError } from "@/lib/crm/http";
import { newReference } from "@/lib/crm/refs";
import { parisDayStartSql, sqlNow, toSql } from "@/lib/crm/time";
import type { Audit, Draft, EmailKind, Lead, Refusal, SendRule } from "@/lib/crm/types";
import { DEFAULT_SIGNATURE, followUp } from "@/lib/drafts/templates";
import { getDraft, latestDraft } from "@/lib/drafts/store";
import { enquiriesDb } from "@/lib/enquiries";
import { addActivity, ensureLeadForProspect, getLead, updateLead } from "@/lib/inbox/leads";
import { followUpDate } from "@/lib/inbox/hooks";
import { mailConfigured, sendMail } from "@/lib/mail";
import { notifyTelegram } from "@/lib/notify";
import { getProspect, type ProspectRecord } from "@/lib/prospects/store";
import { recheckRegister, type RegisterCheck } from "@/lib/prospects/registerCheck";
import { tradeWords } from "@/lib/report/findings";
import { reportTtlDays, reportUrl, rowToAudit } from "@/lib/report/view";
import { SITE_URL } from "@/lib/seo";
import { serverTrack } from "@/lib/serverTrack";
import { FOLLOW_UP_SUBJECT } from "@/content/outreach";
import { cleanSubject, domainForNotice, footerLocale, legalBlockProblems, legalFooter, optoutUrl, renderEmail, type LegalContext } from "./legal";
import { isOptedOut, isProspectOptedOut } from "./optout";
import { newOptoutToken } from "./optoutToken";
import { evaluateRefusals } from "./refusals";
import { emailEnabled, ruleFor, ruleKeyFor, type RuleKey } from "./rules";

/** Error with a stable code and HTTP status for the routes. */
export class SendError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "SendError";
    this.code = code;
    this.status = status;
  }
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

// ---- sender identity ---------------------------------------------------------------------------

/** Bare address out of "Name <addr>" or "addr". */
function bareAddress(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1]! : s).trim();
}

export function outreachFromAddress(): string {
  return bareAddress(process.env.OUTREACH_FROM || process.env.CONTACT_FORM_FROM || process.env.SMTP_USER || "contact@digitalm.eu");
}

export function outreachFromName(): string {
  return (process.env.OUTREACH_FROM_NAME || DEFAULT_SIGNATURE).replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim() || DEFAULT_SIGNATURE;
}

/** `"Radu — Digital M" <addr>` — the header value handed to sendMail. */
export function outreachFrom(): string {
  return `"${outreachFromName()}" <${outreachFromAddress()}>`;
}

export function outreachReplyTo(): string {
  const v = process.env.OUTREACH_REPLY_TO?.trim();
  return v && validEmail(bareAddress(v)) ? bareAddress(v) : outreachFromAddress();
}

// ---- facts --------------------------------------------------------------------------------------

export type RecipientSource = "override" | "website" | "source";

export interface Recipient {
  to: string | null;
  kind: EmailKind | null;
  source: RecipientSource | null;
  page: string | null;
}

/** The address a send would go to: the validated override, else the site's, else the discovery tag. */
export function recipientFor(p: ProspectRecord): Recipient {
  const pick = (email: string | null, source: RecipientSource): Recipient | null =>
    email && validEmail(email) ? { to: email, kind: classifyEmail(email, { domainKey: p.domainKey, soleTrader: p.soleTrader }), source, page: source === "website" ? p.websiteEmailPage : null } : null;
  return pick(p.contactEmailOverride, "override") ?? pick(p.websiteEmail, "website") ?? pick(p.sourceEmail, "source") ?? { to: null, kind: null, source: null, page: null };
}

function latestDoneAudit(prospectId: number): Audit | null {
  const row = enquiriesDb().prepare("SELECT * FROM audits WHERE prospect_id = ? AND status = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1").get(prospectId) as Row | undefined;
  return row ? rowToAudit(row) : null;
}

/** `sent` (by sent_at) and still `pending` (by created_at) rows of any email channel in the last 90 days — the "no third email" counter. */
export function sentCount90d(prospectId: number): number {
  return (
    enquiriesDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM sends WHERE prospect_id = ? AND channel IN ('email', 'manual_email')
           AND ((status = 'sent' AND sent_at > datetime('now', '-90 days')) OR (status = 'pending' AND created_at > datetime('now', '-90 days')))`,
      )
      .get(prospectId) as { n: number }
  ).n;
}

/**
 * Emails of both paths sent since 00:00 Europe/Paris plus the pending rows
 * created since then — what the daily cap is measured against. (crm/db.ts's
 * outreachSentToday counts in-app sent rows only, for the Today card.)
 */
export function outreachUsedToday(): number {
  const dayStart = parisDayStartSql();
  return (
    enquiriesDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM sends WHERE channel IN ('email', 'manual_email')
           AND ((status = 'sent' AND sent_at >= ?) OR (status = 'pending' AND created_at >= ?))`,
      )
      .get(dayStart, dayStart) as { n: number }
  ).n;
}

/** created_at of the newest `pending` email row of the prospect (in flight, or prepared and not yet recorded), else null. */
export function pendingSendAt(prospectId: number): string | null {
  const row = enquiriesDb()
    .prepare("SELECT created_at FROM sends WHERE prospect_id = ? AND status = 'pending' AND channel IN ('email', 'manual_email') ORDER BY id DESC LIMIT 1")
    .get(prospectId) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

/** Legal-block context for a prospect: identity source, where the address came from, trade words. */
export function legalContextFor(p: ProspectRecord, recipient: Recipient, audit: Audit | null, token: string, locale: "fr" | "en"): LegalContext {
  const domain = domainForNotice(p);
  // The email sentence names the site (and page) the address was read from;
  // an address that came with the identity itself (OSM / register tag) is
  // covered by the identity sentence and the clause is omitted. A validated
  // override was typed by the owner and may come from anywhere, so the notice
  // says "a public listing" and claims neither the site nor a date for it —
  // the owner sees that wording in the panel before sending.
  const emailSource: LegalContext["emailSource"] =
    !recipient.to || recipient.source === "source"
      ? null
      : recipient.source === "override"
        ? { kind: "listing" }
        : domain
          ? { kind: "website", domain, page: recipient.page, auditDate: audit?.finishedAt ?? null }
          : null;
  return {
    siteUrl: SITE_URL,
    token,
    prospect: { source: p.source, website: p.website, domainKey: p.domainKey, savedAt: p.savedAt, tradeKey: p.tradeKey },
    trade: tradeWords(p.tradeKey, locale),
    emailSource,
  };
}

export interface SendFacts {
  prospect: ProspectRecord;
  rule: SendRule;
  ruleKey: RuleKey;
  emailEnabled: boolean;
  recipient: Recipient;
  audit: Audit | null;
  draft: Draft | null;
  lead: Lead | null;
  optedOut: boolean;
  /** Sent or pending today, both paths. */
  todaySent: number;
  dailyCap: number;
  /** Sent or pending in 90 days, both paths. */
  sentCount90d: number;
  /** A row still pending for this prospect — a reservation that refuses a second send. */
  pendingSendAt: string | null;
}

export function sendFacts(prospectId: number, draftId?: number | null): SendFacts {
  const prospect = getProspect(prospectId);
  if (!prospect || prospect.deletedAt) throw new SendError("prospect_not_found", 404);
  const draft = typeof draftId === "number" ? getDraft(draftId) : latestDraft(prospectId);
  if (typeof draftId === "number" && (!draft || draft.prospectId !== prospectId)) throw new SendError("draft_not_found", 404);
  return {
    prospect,
    rule: ruleFor(prospect.country),
    ruleKey: ruleKeyFor(prospect.country),
    emailEnabled: emailEnabled(prospect.country),
    recipient: recipientFor(prospect),
    audit: latestDoneAudit(prospectId),
    draft,
    lead: prospect.leadId !== null ? getLead(prospect.leadId) : null,
    optedOut: isProspectOptedOut(prospect),
    todaySent: outreachUsedToday(),
    dailyCap: outreachDailyCap(),
    sentCount90d: sentCount90d(prospectId),
    pendingSendAt: pendingSendAt(prospectId),
  };
}

function refusalsFor(f: SendFacts, opts: { channel: "email" | "manual_email"; followUp: boolean; registerCheck: RegisterCheck | null }): Refusal[] {
  return evaluateRefusals({
    prospect: f.prospect,
    to: f.recipient.to,
    audit: f.audit ? { finishedAt: f.audit.finishedAt } : null,
    draft: f.draft ? { reviewedAt: f.draft.reviewedAt } : null,
    rule: f.rule,
    emailEnabled: f.emailEnabled,
    todaySent: f.todaySent,
    dailyCap: f.dailyCap,
    channel: opts.channel,
    sentCount90d: f.sentCount90d,
    pendingSendAt: f.pendingSendAt,
    optedOut: f.optedOut,
    lead: f.lead ? { stage: f.lead.stage } : null,
    registerCheck: opts.registerCheck?.checked ? { registerStatus: opts.registerCheck.registerStatus, diffusion: opts.registerCheck.diffusion } : null,
    followUp: opts.followUp,
    requireDraft: !opts.followUp,
  });
}

/** Live register re-check; a network failure is a hard stop, never a guess. */
async function liveRegisterCheck(p: ProspectRecord): Promise<RegisterCheck> {
  try {
    return await recheckRegister(p);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : "register_check_failed";
    throw new SendError(`register_check_failed:${code}`, 503);
  }
}

// ---- panel state -----------------------------------------------------------------------------------

export interface SendSummary {
  id: number;
  reference: string;
  channel: string;
  status: string;
  refusalCodes: string[];
  error: string | null;
  subject: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** Recent rows of a prospect — never the body (contract §10). */
export function listSends(prospectId: number, limit = 10): SendSummary[] {
  const rows = enquiriesDb()
    .prepare("SELECT id, reference, channel, status, refusal_codes, error, subject, sent_at, created_at FROM sends WHERE prospect_id = ? ORDER BY id DESC LIMIT ?")
    .all(prospectId, limit) as Row[];
  return rows.map((r) => {
    let codes: string[] = [];
    try {
      const parsed = JSON.parse(String(r.refusal_codes ?? "[]")) as unknown;
      codes = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      codes = [];
    }
    return {
      id: Number(r.id),
      reference: String(r.reference),
      channel: String(r.channel),
      status: String(r.status),
      refusalCodes: codes,
      error: str(r.error),
      subject: str(r.subject),
      sentAt: str(r.sent_at),
      createdAt: String(r.created_at ?? ""),
    };
  });
}

export interface SendPanelState {
  prospect: {
    id: number;
    reference: string;
    name: string;
    country: string;
    locale: "fr" | "en";
    ruleKey: RuleKey;
    emailEnabled: boolean;
    optedOutAt: string | null;
    lastEmailedAt: string | null;
    noticeSentAt: string | null;
    noticeDeadlineAt: string | null;
    registerStatus: string;
    leadId: number | null;
    leadStage: string | null;
  };
  recipient: Recipient;
  from: string;
  replyTo: string;
  smtp: boolean;
  audit: { id: number; reference: string; finishedAt: string | null; score: number | null; grade: string | null; reportUrl: string; reportExpiresAt: string | null } | null;
  draft: { id: number; subject: string; locale: "fr" | "en"; reviewedAt: string | null; auditId: number } | null;
  /** Refusals for sending the draft in-app (stored register status; the live re-check runs at send time). */
  refusals: Refusal[];
  /** Refusals for the 7-day follow-up (manual path). */
  followUpRefusals: Refusal[];
  legalPreview: string;
  /** What makes the rendered block unfit to send (legalBlockProblems); empty when complete. Both send paths refuse while non-empty. */
  legalProblems: string[];
  /** Sent or pending today, both paths, against the cap. */
  cap: { used: number; cap: number };
  /** Sent or pending in 90 days, both paths. */
  sentCount90d: number;
  sends: SendSummary[];
}

/** What SendPanel self-loads from GET /api/admin/prospects/[id]/send. No network calls here. */
export function sendPanelState(prospectId: number): SendPanelState {
  const f = sendFacts(prospectId);
  const p = f.prospect;
  const locale = footerLocale(f.rule, f.draft?.locale ?? p.locale);
  const preview = legalFooter(f.rule, legalContextFor(p, f.recipient, f.audit, "TOKEN", locale), locale);
  return {
    prospect: {
      id: p.id,
      reference: p.reference,
      name: p.name,
      country: p.country,
      locale: p.locale,
      ruleKey: f.ruleKey,
      emailEnabled: f.emailEnabled,
      optedOutAt: p.optedOutAt,
      lastEmailedAt: p.lastEmailedAt,
      noticeSentAt: p.noticeSentAt,
      noticeDeadlineAt: p.noticeDeadlineAt,
      registerStatus: p.registerStatus,
      leadId: p.leadId,
      leadStage: f.lead?.stage ?? null,
    },
    recipient: f.recipient,
    from: outreachFrom(),
    replyTo: outreachReplyTo(),
    smtp: mailConfigured(),
    audit: f.audit
      ? { id: f.audit.id, reference: f.audit.reference, finishedAt: f.audit.finishedAt, score: f.audit.score, grade: f.audit.grade, reportUrl: reportUrl(f.audit.reportToken), reportExpiresAt: f.audit.reportExpiresAt }
      : null,
    draft: f.draft ? { id: f.draft.id, subject: f.draft.subject, locale: f.draft.locale, reviewedAt: f.draft.reviewedAt, auditId: f.draft.auditId } : null,
    refusals: refusalsFor(f, { channel: "email", followUp: false, registerCheck: null }),
    followUpRefusals: refusalsFor(f, { channel: "manual_email", followUp: true, registerCheck: null }),
    legalPreview: preview,
    legalProblems: legalBlockProblems(preview),
    cap: { used: f.todaySent, cap: f.dailyCap },
    sentCount90d: f.sentCount90d,
    sends: listSends(prospectId),
  };
}

// ---- shared effects ---------------------------------------------------------------------------------

interface SentRow {
  id: number;
  reference: string;
  prospectId: number;
  prospectReference: string;
  auditId: number | null;
  channel: "email" | "manual_email";
  subject: string;
  /** The row's sent_at — last_emailed_at never moves backwards on a repair. */
  sentAt: string;
}

/**
 * Everything a successful send changes besides its own row: the prospect's
 * last_emailed_at and first notice date, the audit's report expiry, the lead
 * (created as outreach/contacted with a 7-day follow-up, or nudged from
 * `new`), and the activity. One transaction, re-runnable: every write is a
 * COALESCE / MAX and the activity is written once per send reference, so the
 * owner repairs a send whose bookkeeping failed instead of sending again.
 */
function applySentEffects(send: SentRow): Lead {
  const db = enquiriesDb();
  return db.transaction(() => {
    const now = sqlNow();
    db.prepare("UPDATE prospects SET last_emailed_at = MAX(COALESCE(last_emailed_at, ''), ?), notice_sent_at = COALESCE(notice_sent_at, ?), updated_at = ? WHERE id = ?").run(
      send.sentAt,
      send.sentAt,
      now,
      send.prospectId,
    );
    if (send.auditId !== null) {
      const expires = toSql(new Date(Date.now() + reportTtlDays() * 86_400_000));
      db.prepare("UPDATE audits SET report_expires_at = COALESCE(report_expires_at, ?) WHERE id = ?").run(expires, send.auditId);
    }
    const nextAction = "Relance si pas de réponse";
    const nextActionAt = followUpDate(7);
    let lead = ensureLeadForProspect(send.prospectId, { kind: "outreach", stage: "contacted", nextAction, nextActionAt });
    if (lead.stage === "new") lead = updateLead(lead.id, { stage: "contacted", nextAction, nextActionAt }, "admin") ?? lead;
    else if (lead.stage === "contacted" && !lead.nextActionAt) lead = updateLead(lead.id, { nextAction, nextActionAt }, "admin") ?? lead;
    db.prepare("UPDATE leads SET notice_sent_at = COALESCE(notice_sent_at, ?) WHERE id = ?").run(send.sentAt, lead.id);
    db.prepare("UPDATE sends SET lead_id = COALESCE(lead_id, ?) WHERE id = ?").run(lead.id, send.id);
    const logged = db
      .prepare(
        "SELECT 1 AS hit FROM activities WHERE prospect_id = ? AND kind IN ('email_out', 'manual_send') AND payload IS NOT NULL AND json_valid(payload) AND json_extract(payload, '$.send') = ? LIMIT 1",
      )
      .get(send.prospectId, send.reference);
    if (!logged) {
      addActivity({
        leadId: lead.id,
        prospectId: send.prospectId,
        kind: send.channel === "email" ? "email_out" : "manual_send",
        channel: "email",
        summary: send.channel === "email" ? `Email sent · ${send.reference} · ${send.subject}` : `Sent by hand (Gmail) · ${send.reference} · ${send.subject}`,
        payload: { send: send.reference },
        actor: "admin",
      });
    }
    return lead;
  })();
}

export type SentWarning = "bookkeeping_failed" | null;

/**
 * The bookkeeping after an email has left (or been recorded as sent): never
 * lets a failure look like a failed send. The row stays `sent`; the owner is
 * told to repair, not to send again — a second email is what the counters
 * could no longer catch.
 */
function bookkeeping(send: SentRow, track: () => void): { lead: Lead | null; warning: SentWarning } {
  try {
    const lead = applySentEffects(send);
    track();
    return { lead, warning: null };
  } catch (e) {
    const code = String((e as { code?: string }).code ?? (e as Error).name ?? "error").slice(0, 60);
    console.error(`outreach send ${send.reference} went out but the bookkeeping failed (${code})`);
    notifyTelegram(`Outreach send ${send.reference} went out but the bookkeeping failed (${code}) — ${send.prospectReference}. Do NOT send again: open the prospect and use "Repair bookkeeping".`);
    return { lead: null, warning: "bookkeeping_failed" };
  }
}

/** Re-run the bookkeeping of a `sent` row (409 unless sent). Idempotent; used by the panel after a bookkeeping failure. */
export function repairSentEffects(sendId: number, prospectId: number): { send: SendSummary; lead: Lead } {
  const row = enquiriesDb()
    .prepare("SELECT s.id, s.reference, s.prospect_id, s.audit_id, s.channel, s.status, s.subject, s.sent_at, p.reference AS prospect_reference FROM sends s JOIN prospects p ON p.id = s.prospect_id WHERE s.id = ?")
    .get(sendId) as { id: number; reference: string; prospect_id: number; audit_id: number | null; channel: string; status: string; subject: string | null; sent_at: string | null; prospect_reference: string } | undefined;
  if (!row || row.prospect_id !== prospectId) throw new SendError("send_not_found", 404);
  if (row.status !== "sent" || (row.channel !== "email" && row.channel !== "manual_email")) throw new SendError("not_sent", 409);
  const lead = applySentEffects({
    id: row.id,
    reference: row.reference,
    prospectId,
    prospectReference: row.prospect_reference,
    auditId: row.audit_id,
    channel: row.channel,
    subject: row.subject ?? "",
    sentAt: row.sent_at ?? sqlNow(),
  });
  return { send: listSends(prospectId, 50).find((s) => s.id === sendId)!, lead };
}

function insertSendRow(input: {
  reference: string;
  prospectId: number;
  leadId: number | null;
  auditId: number | null;
  draftId: number | null;
  channel: "email" | "manual_email";
  to: string | null;
  from: string | null;
  subject: string | null;
  bodyText: string | null;
  legalBlock: string | null;
  optoutToken: string | null;
  status: "pending" | "refused";
  refusalCodes: string[];
  country: string;
  ruleKey: RuleKey;
}): number {
  const info = enquiriesDb()
    .prepare(
      `INSERT INTO sends (reference, prospect_id, lead_id, audit_id, draft_id, channel, to_email, to_hash, from_email, subject, body_text, legal_block,
                          optout_token, status, refusal_codes, country, rule_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.reference,
      input.prospectId,
      input.leadId,
      input.auditId,
      input.draftId,
      input.channel,
      input.to,
      input.to ? hashEmail(input.to) : null,
      input.from,
      input.subject,
      input.bodyText,
      input.legalBlock,
      input.optoutToken,
      input.status,
      JSON.stringify(input.refusalCodes),
      input.country,
      input.ruleKey,
      sqlNow(),
    );
  return Number(info.lastInsertRowid);
}

function recordRefusal(f: SendFacts, channel: "email" | "manual_email", refusals: Refusal[]): { id: number; reference: string } {
  const reference = newReference("SN");
  const codes = refusals.map((r) => r.code);
  const id = insertSendRow({
    reference,
    prospectId: f.prospect.id,
    leadId: f.prospect.leadId,
    auditId: f.audit?.id ?? null,
    draftId: f.draft?.id ?? null,
    channel,
    to: null,
    from: null,
    subject: f.draft ? cleanSubject(f.draft.subject) : null,
    bodyText: null,
    legalBlock: null,
    optoutToken: null,
    status: "refused",
    refusalCodes: codes,
    country: f.prospect.country,
    ruleKey: f.ruleKey,
  });
  addActivity({ prospectId: f.prospect.id, leadId: f.prospect.leadId, kind: "send_refused", channel: "email", summary: `Send refused · ${reference} · ${codes.join(", ")}`, payload: { send: reference, codes: codes.join(",") }, actor: "system" });
  return { id, reference };
}

// ---- in-app send -------------------------------------------------------------------------------------

export type SendResult =
  | { ok: true; send: SendSummary; lead: Lead | null; warning: SentWarning }
  | { ok: false; refusals: Refusal[]; reference: string }
  | { ok: false; error: "smtp_failed"; code: string; reference: string };

/** An incomplete Art. 14 notice never leaves: 409 legal_block_incomplete (the panel lists the problems). */
function assertLegalComplete(legal: string): void {
  if (legalBlockProblems(legal).length) throw new SendError("legal_block_incomplete", 409);
}

/**
 * Send the reviewed draft to the prospect. Order matters: facts → live
 * register re-check → facts again (the re-check may have wiped fields, and a
 * concurrent send may have reserved its row while we waited) → refusals
 * (each one logged as a refused row) → pending row committed → one SMTP
 * attempt → sent/failed. A failure alerts Telegram and is never retried
 * automatically: the owner sees it and decides.
 */
export async function sendOutreach(input: { prospectId: number; draftId?: number | null }): Promise<SendResult> {
  const facts = sendFacts(input.prospectId, input.draftId ?? null);
  const registerCheck = await liveRegisterCheck(facts.prospect);
  const f = sendFacts(input.prospectId, input.draftId ?? null);
  const refusals = refusalsFor(f, { channel: "email", followUp: false, registerCheck });
  if (refusals.length) {
    const { reference } = recordRefusal(f, "email", refusals);
    return { ok: false, refusals, reference };
  }
  const p = f.prospect;
  const draft = f.draft!;
  const to = f.recipient.to!;
  const locale = footerLocale(f.rule, draft.locale);
  const token = newOptoutToken();
  const ctx = legalContextFor(p, f.recipient, f.audit, token, locale);
  const { text, html, legal } = renderEmail(draft.body, f.rule, ctx, locale);
  assertLegalComplete(legal);
  const subject = cleanSubject(draft.subject);
  const from = outreachFrom();
  const replyTo = outreachReplyTo();
  const reference = newReference("SN");

  // (4) the row exists before any SMTP traffic.
  const sendId = insertSendRow({
    reference,
    prospectId: p.id,
    leadId: p.leadId,
    auditId: f.audit?.id ?? null,
    draftId: draft.id,
    channel: "email",
    to,
    from: outreachFromAddress(),
    subject,
    bodyText: text,
    legalBlock: legal,
    optoutToken: token,
    status: "pending",
    refusalCodes: [],
    country: p.country,
    ruleKey: f.ruleKey,
  });

  // Only the SMTP call decides sent vs failed: once the email has left, the
  // row is `sent` whatever happens next.
  let messageId: string | null;
  try {
    ({ messageId } = await sendMail({
      to: { address: to },
      from,
      replyTo,
      subject,
      text,
      html,
      headers: {
        "List-Unsubscribe": `<${SITE_URL}/api/o/${token}>, <mailto:${replyTo}?subject=STOP%20${reference}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      attempts: 1,
    }));
  } catch (e) {
    const code = String((e as { code?: string }).code ?? (e as Error).name ?? "smtp_error").slice(0, 60);
    enquiriesDb().prepare("UPDATE sends SET status = 'failed', error = ? WHERE id = ?").run(code, sendId);
    console.error(`outreach send ${reference} failed (${code})`);
    notifyTelegram(`Outreach send ${reference} failed (${code}) — ${p.reference}. Nothing was retried; check SMTP and send again from the panel.`);
    return { ok: false, error: "smtp_failed", code, reference };
  }
  const sentAt = sqlNow();
  enquiriesDb().prepare("UPDATE sends SET status = 'sent', sent_at = ?, smtp_message_id = ? WHERE id = ?").run(sentAt, messageId, sendId);
  const { lead, warning } = bookkeeping({ id: sendId, reference, prospectId: p.id, prospectReference: p.reference, auditId: f.audit?.id ?? null, channel: "email", subject, sentAt }, () => {
    countApiUsage("outreach_email");
    serverTrack("outreach_sent", { ref: reference });
  });
  const send = listSends(p.id, 50).find((s) => s.id === sendId)!;
  return { ok: true, send, lead, warning };
}

// ---- manual send (Gmail) ----------------------------------------------------------------------------

export interface PreparedSend {
  sendId: number;
  reference: string;
  subject: string;
  /** Body + legal block with the opt-out URL resolved — what the owner pastes. */
  text: string;
  optoutUrl: string;
}

/** Subject of the follow-up: "Re: <first subject>" when one went out, else the template subject. */
function followUpSubject(prospectId: number, locale: "fr" | "en"): string {
  const last = enquiriesDb()
    .prepare("SELECT subject FROM sends WHERE prospect_id = ? AND status = 'sent' AND channel IN ('email', 'manual_email') AND subject IS NOT NULL ORDER BY sent_at DESC, id DESC LIMIT 1")
    .get(prospectId) as { subject: string } | undefined;
  return last?.subject ? cleanSubject(/^re\s*:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : FOLLOW_UP_SUBJECT[locale];
}

/**
 * Same refusals as the in-app send (stored register status plus a live
 * re-check), then a pending `manual_email` row with its own opt-out token and
 * the legal block, returned as the text to paste. `draftId: "followup"` uses
 * the 7-day follow-up template instead of a draft; null means the newest draft.
 */
export async function prepareManualSend(prospectId: number, draftId: number | "followup" | null): Promise<PreparedSend | { ok: false; refusals: Refusal[]; reference: string }> {
  const isFollowUp = draftId === "followup";
  const facts = sendFacts(prospectId, isFollowUp ? null : draftId);
  const registerCheck = await liveRegisterCheck(facts.prospect);
  // Reloaded after the await: a row prepared or sent meanwhile must count.
  const f = sendFacts(prospectId, isFollowUp ? null : draftId);
  const refusals = refusalsFor(f, { channel: "manual_email", followUp: isFollowUp, registerCheck });
  if (refusals.length) {
    const { reference } = recordRefusal(f, "manual_email", refusals);
    return { ok: false, refusals, reference };
  }
  const p = f.prospect;
  const to = f.recipient.to!;
  const locale = isFollowUp ? p.locale : footerLocale(f.rule, f.draft!.locale);
  const token = newOptoutToken();
  const ctx = legalContextFor(p, f.recipient, f.audit, token, locale);
  const body = isFollowUp ? followUp(p.locale, { reportUrl: f.audit ? reportUrl(f.audit.reportToken) : null, signature: outreachFromName() }) : f.draft!.body;
  const subject = isFollowUp ? followUpSubject(p.id, p.locale) : cleanSubject(f.draft!.subject);
  const { text, legal } = renderEmail(body, f.rule, ctx, locale);
  assertLegalComplete(legal);
  const reference = newReference("SN");
  const sendId = insertSendRow({
    reference,
    prospectId: p.id,
    leadId: p.leadId,
    auditId: f.audit?.id ?? null,
    draftId: isFollowUp ? null : f.draft!.id,
    channel: "manual_email",
    to,
    from: outreachFromAddress(),
    subject,
    bodyText: text,
    legalBlock: legal,
    optoutToken: token,
    status: "pending",
    refusalCodes: [],
    country: p.country,
    ruleKey: f.ruleKey,
  });
  return { sendId, reference, subject, text, optoutUrl: optoutUrl(SITE_URL, token) };
}

type PendingRow = { id: number; reference: string; prospect_id: number; audit_id: number | null; channel: string; status: string; subject: string | null; to_email: string | null; to_hash: string | null };

function pendingRow(sendId: number, prospectId: number, channels: readonly string[]): PendingRow {
  const row = enquiriesDb().prepare("SELECT id, reference, prospect_id, audit_id, channel, status, subject, to_email, to_hash FROM sends WHERE id = ?").get(sendId) as PendingRow | undefined;
  if (!row || row.prospect_id !== prospectId) throw new SendError("send_not_found", 404);
  if (!channels.includes(row.channel) || row.status !== "pending") throw new SendError("not_prepared", 409);
  return row;
}

/**
 * "I sent it from Gmail": the prepared row becomes `sent` with the same
 * prospect / lead / audit effects. 409 unless prepared. The row is `sent`
 * before the bookkeeping runs: a bookkeeping failure comes back as a warning,
 * never as a reason to send again.
 */
export function recordManualSend(sendId: number, prospectId: number): { send: SendSummary; lead: Lead | null; warning: SentWarning } {
  const row = pendingRow(sendId, prospectId, ["manual_email"]);
  // The opposition list is checked before every send — a STOP may have landed
  // between preparing and confirming.
  const p = getProspect(prospectId);
  if (!p) throw new SendError("prospect_not_found", 404);
  if (isProspectOptedOut(p) || (row.to_hash !== null && isOptedOut({ emailHash: row.to_hash }))) throw new SendError("optout_listed", 409);
  const sentAt = sqlNow();
  enquiriesDb().prepare("UPDATE sends SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'pending'").run(sentAt, sendId);
  const { lead, warning } = bookkeeping({ id: row.id, reference: row.reference, prospectId, prospectReference: p.reference, auditId: row.audit_id, channel: "manual_email", subject: row.subject ?? "", sentAt }, () =>
    serverTrack("outreach_manual_sent", { ref: row.reference }),
  );
  const send = listSends(prospectId, 50).find((s) => s.id === sendId)!;
  return { send, lead, warning };
}

/**
 * Cancel a pending row: a prepared manual send that was never pasted, or an
 * in-app row left `pending` by a process that died mid-SMTP (it reserves the
 * prospect until cleared — the owner checks the mailbox first). The row is
 * kept as `failed / cancelled`, nothing else changes.
 */
export function cancelManualSend(sendId: number, prospectId: number): SendSummary {
  pendingRow(sendId, prospectId, ["manual_email", "email"]);
  enquiriesDb().prepare("UPDATE sends SET status = 'failed', error = 'cancelled' WHERE id = ? AND status = 'pending'").run(sendId);
  return listSends(prospectId, 50).find((s) => s.id === sendId)!;
}
