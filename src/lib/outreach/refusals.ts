// Refusal engine (contract §9 "Refusals"): every failing rule for an email
// send or a call, each with its plain-words reason in FR and EN. Pure — the
// callers (send.ts, calls.ts) gather the facts from the DB and the live
// register re-check; this file only decides. Codes come back in a fixed
// order so the panel reads the same way every time.
import type { LeadStage, Prospect, Refusal, RefusalCode, SendRule } from "../crm/types.ts";
import { classifyEmail, validEmail } from "../crm/classify.ts";
import { daysSinceSql, sqlToMs } from "../crm/time.ts";
import { REFUSAL_MESSAGES } from "../../content/outreach.ts";
import { callWindowStatus } from "./rules.ts";

const CLOSED: readonly LeadStage[] = ["won", "lost", "stop", "no_response"];
const IN_CONVERSATION: readonly LeadStage[] = ["replied", "meeting", "proposal"];

/** GB screening (PECR reg 21) is valid for 28 days. */
export const TPS_VALID_DAYS = 28;

export function refusal(code: RefusalCode): Refusal {
  return { code, message: REFUSAL_MESSAGES[code] };
}

export function refusalsOf(codes: readonly RefusalCode[]): Refusal[] {
  return codes.map(refusal);
}

// ---- email --------------------------------------------------------------------------------------

export type ProspectFacts = Pick<
  Prospect,
  | "country"
  | "soleTrader"
  | "registerId"
  | "registerStatus"
  | "diffusion"
  | "forbidsExtraction"
  | "forbidsOverrideReason"
  | "noticeSentAt"
  | "noticeDeadlineAt"
  | "personalWipedAt"
  | "fit"
  | "lastEmailedAt"
  | "optedOutAt"
>;

export interface EmailRefusalContext {
  prospect: ProspectFacts;
  /** The address the email would go to (override, else website email); null when none. */
  to: string | null;
  /** Latest finished audit, or null. */
  audit: { finishedAt: string | null } | null;
  /** The draft to send; null for the follow-up template (then `requireDraft` is false). */
  draft: { reviewedAt: string | null } | null;
  rule: SendRule;
  /** emailEnabled(country) — rule row AND OUTREACH_COUNTRY_ALLOW. */
  emailEnabled: boolean;
  /** In-app emails sent today (Europe/Paris) and the cap; the cap only applies to channel "email". */
  todaySent: number;
  dailyCap: number;
  channel: "email" | "manual_email";
  /** sent rows (email | manual_email) in the last 90 days. */
  sentCount90d: number;
  /** Opposition list hit for the address (or prospects.opted_out_at). */
  optedOut: boolean;
  lead: { stage: LeadStage } | null;
  /** Result of the live register re-check, when one ran; else the stored status is used. */
  registerCheck: { registerStatus: Prospect["registerStatus"]; diffusion: Prospect["diffusion"] } | null;
  /** True for the 7-day follow-up: emailed_recently does not apply, max_emails_reached does. */
  followUp?: boolean;
  requireDraft?: boolean;
  now?: Date;
}

/** Every failing email rule, in display order. Empty → the send may go. */
export function evaluateRefusals(ctx: EmailRefusalContext): Refusal[] {
  const now = ctx.now ?? new Date();
  const p = ctx.prospect;
  const codes: RefusalCode[] = [];
  const push = (c: RefusalCode) => {
    if (!codes.includes(c)) codes.push(c);
  };

  if (!ctx.emailEnabled) push("country_blocked");

  // Recipient.
  const to = ctx.to && validEmail(ctx.to) ? ctx.to : null;
  if (!to) push("no_email");
  else {
    const kind = classifyEmail(to, { soleTrader: p.soleTrader });
    if (kind === "webmail") push("email_webmail");
  }
  if (ctx.rule.soleTraderEmail === "consent_required" && p.soleTrader === true) push("email_sole_trader_consent");
  if (ctx.rule.unknownLegalFormEmail === "call_only" && (p.registerId === null || p.soleTrader === null)) push("email_unknown_legal_form");

  // Opposition and frequency.
  if (ctx.optedOut || p.optedOutAt) push("optout_listed");
  const sinceEmail = daysSinceSql(p.lastEmailedAt, now);
  if (!ctx.followUp && sinceEmail !== null && sinceEmail < ctx.rule.reEmailAfterDays) push("emailed_recently");
  if (ctx.sentCount90d >= ctx.rule.maxEmailsPer90d) push("max_emails_reached");

  // Audit and draft.
  if (!ctx.audit) push("audit_missing");
  else {
    const age = daysSinceSql(ctx.audit.finishedAt, now);
    if (age === null || age > ctx.rule.auditMaxAgeDays) push("audit_stale");
  }
  if (ctx.channel === "email" && ctx.todaySent >= ctx.dailyCap) push("daily_cap");
  if (p.forbidsExtraction && !p.forbidsOverrideReason) push("forbids_extraction");

  // Register (live result wins over the stored columns).
  const registerStatus = ctx.registerCheck?.registerStatus ?? p.registerStatus;
  const diffusion = ctx.registerCheck?.diffusion ?? p.diffusion;
  if (registerStatus === "ceased") push("register_inactive");
  if (diffusion === "partial") push("register_partial");

  // Art. 14 one-month rule, every country.
  const deadline = sqlToMs(p.noticeDeadlineAt);
  if (p.noticeSentAt === null && deadline !== null && deadline < now.getTime() && p.personalWipedAt === null) push("notice_deadline_passed");

  if (p.fit === "not_fit") push("not_a_fit");
  if (ctx.requireDraft !== false && (!ctx.draft || !ctx.draft.reviewedAt)) push("draft_unreviewed");

  if (ctx.lead) {
    if (CLOSED.includes(ctx.lead.stage)) push("stage_closed");
    if (IN_CONVERSATION.includes(ctx.lead.stage)) push("lead_in_conversation");
  }
  return refusalsOf(codes);
}

// ---- calls --------------------------------------------------------------------------------------

export type CallFacts = Pick<Prospect, "registerStatus" | "diffusion" | "tpsCheckedAt" | "optedOutAt" | "noticeSentAt" | "noticeDeadlineAt" | "personalWipedAt">;

export interface CallRefusalContext {
  prospect: CallFacts;
  rule: SendRule;
  /** Opposition list hit for the phone (or the email on file). */
  optedOut: boolean;
  /** `call` activities in the last 30 days. */
  attempts30d: number;
  /** The admin ticked "screened against TPS and CTPS today" on this call. */
  tpsChecked?: boolean;
  registerCheck: { registerStatus: Prospect["registerStatus"]; diffusion: Prospect["diffusion"] } | null;
  now?: Date;
}

/** True when a GB screening on record is still inside its 28 days. */
export function screeningValid(tpsCheckedAt: string | null, now = new Date()): boolean {
  const age = daysSinceSql(tpsCheckedAt, now);
  return age !== null && age >= 0 && age <= TPS_VALID_DAYS;
}

/** Every failing call rule, in display order. Empty → the call may be logged. */
export function evaluateCallRefusals(ctx: CallRefusalContext): Refusal[] {
  const now = ctx.now ?? new Date();
  const p = ctx.prospect;
  const codes: RefusalCode[] = [];

  if (ctx.optedOut || p.optedOutAt) codes.push("optout_listed");
  const registerStatus = ctx.registerCheck?.registerStatus ?? p.registerStatus;
  const diffusion = ctx.registerCheck?.diffusion ?? p.diffusion;
  if (registerStatus === "ceased") codes.push("register_inactive");
  if (diffusion === "partial") codes.push("register_partial");

  const deadline = sqlToMs(p.noticeDeadlineAt);
  if (p.noticeSentAt === null && deadline !== null && deadline < now.getTime() && p.personalWipedAt === null) codes.push("notice_deadline_passed");

  if (!callWindowStatus(ctx.rule.callWindow, now).open) codes.push("call_window_closed");
  if (ctx.attempts30d >= ctx.rule.maxCallAttempts30d) codes.push("call_attempts_exceeded");
  if (ctx.rule.callAllowed === "screened" && !ctx.tpsChecked && !screeningValid(p.tpsCheckedAt, now)) codes.push("call_screening_missing");

  return refusalsOf(codes);
}
