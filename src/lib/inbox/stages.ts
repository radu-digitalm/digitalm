// Pure lead rules shared by the store, the routes and the UI (contract §5):
// the stage and kind lists with their labels, which stages count as closed or
// "in conversation", what a stage change writes to replied_at/closed_at, the
// merge rules (kind upgrade, 180-day window) and a few display helpers. Only
// types and crm/time.ts (no imports itself), so node --test loads it.
import type { LeadKind, LeadStage } from "../crm/types.ts";
import { sqlToMs } from "../crm/time.ts";

export const LEAD_STAGES: readonly LeadStage[] = ["new", "contacted", "replied", "meeting", "proposal", "won", "lost", "no_response", "stop"];
export const LEAD_KINDS: readonly LeadKind[] = ["diagnostic", "booking", "contact", "chat", "messenger", "outreach", "manual"];

/** Closed stages: no follow-ups, excluded from the merge search and from Today. */
export const CLOSED_STAGES: readonly LeadStage[] = ["won", "lost", "no_response", "stop"];
/** The prospect answered — outreach's `lead_in_conversation` refusal keys off these. */
export const CONVERSATION_STAGES: readonly LeadStage[] = ["replied", "meeting", "proposal"];
export const OPEN_STAGES: readonly LeadStage[] = LEAD_STAGES.filter((s) => !CLOSED_STAGES.includes(s));

export function isLeadStage(x: unknown): x is LeadStage {
  return typeof x === "string" && (LEAD_STAGES as readonly string[]).includes(x);
}

export function isLeadKind(x: unknown): x is LeadKind {
  return typeof x === "string" && (LEAD_KINDS as readonly string[]).includes(x);
}

export function isClosedStage(stage: LeadStage): boolean {
  return CLOSED_STAGES.includes(stage);
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
  no_response: "No response",
  stop: "STOP",
};

export const KIND_LABELS: Record<LeadKind, string> = {
  diagnostic: "Diagnostic",
  booking: "Booking",
  contact: "Contact form",
  chat: "Chat",
  messenger: "Messenger",
  outreach: "Outreach",
  manual: "Manual",
};

// Same five names as the Badge component's variants (kept as plain strings so
// lib code never imports a component).
export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

export const STAGE_TONE: Record<LeadStage, Tone> = {
  new: "info",
  contacted: "neutral",
  replied: "good",
  meeting: "good",
  proposal: "good",
  won: "good",
  lost: "neutral",
  no_response: "warn",
  stop: "bad",
};

// ---- stage changes ------------------------------------------------------------

export interface StagePatch {
  stage: LeadStage;
  repliedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

/**
 * Columns a stage change writes, or null when the stage is unchanged.
 * Entering a conversation stage (or won) stamps replied_at once; entering a
 * closed stage stamps closed_at with the stage as the reason; leaving a closed
 * stage reopens the lead (closed_at and close_reason cleared).
 */
export function stagePatch(lead: { stage: LeadStage; repliedAt: string | null }, to: LeadStage, nowSql: string): StagePatch | null {
  if (to === lead.stage) return null;
  const replies = CONVERSATION_STAGES.includes(to) || to === "won";
  const closed = CLOSED_STAGES.includes(to);
  return {
    stage: to,
    repliedAt: lead.repliedAt ?? (replies ? nowSql : null),
    closedAt: closed ? nowSql : null,
    closeReason: closed ? to : null,
  };
}

/** "Mark replied" only moves a lead that was waiting (new/contacted). */
export function stageAfterReply(stage: LeadStage): LeadStage {
  return stage === "new" || stage === "contacted" ? "replied" : stage;
}

// ---- the forward path ---------------------------------------------------------

/**
 * The stages a lead walks through in order, drawn as the path on the lead page.
 * Lost, No response and STOP are off the path: they are reached through the
 * "Change stage" select, never by the one-tap button.
 */
export const FORWARD_STAGES: readonly LeadStage[] = ["new", "contacted", "replied", "meeting", "proposal", "won"];

/** One step further along the path, or null at the end of it and for the three stages off it. */
export function nextForwardStage(stage: LeadStage): LeadStage | null {
  const i = FORWARD_STAGES.indexOf(stage);
  return i >= 0 && i < FORWARD_STAGES.length - 1 ? FORWARD_STAGES[i + 1] : null;
}

// The words on the one primary button of the stage path. "They replied" is the
// customer's move, so it is written as an inbound reply (markReplied), not as a
// plain stage change — the two write different rows.
const NEXT_MOVE_LABELS: Partial<Record<LeadStage, string>> = {
  new: "Mark contacted",
  contacted: "They replied",
  replied: "Mark meeting",
  meeting: "Mark proposal",
  proposal: "Mark won",
};

/** What the next move is called, or null when there is no forward move to offer. */
export function nextMoveLabel(stage: LeadStage): string | null {
  return NEXT_MOVE_LABELS[stage] ?? null;
}

// ---- logging a call -----------------------------------------------------------

/**
 * The five outcomes a logged call can have — the same five the outreach call
 * log uses, repeated here because this module is pure: the box on the lead page
 * and the lead activity route both read it without loading the outreach rules
 * (which need a prospect; logging a call on the lead page does not).
 */
export const CALL_OUTCOMES = ["no_answer", "answered", "callback", "refused", "wrong_number"] as const;
export type CallLogOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallLogOutcome, string> = {
  no_answer: "No answer",
  answered: "Answered",
  callback: "Call back",
  refused: "Refused — do not call again",
  wrong_number: "Wrong number",
};

export function isCallLogOutcome(x: unknown): x is CallLogOutcome {
  return typeof x === "string" && (CALL_OUTCOMES as readonly string[]).includes(x);
}

/** Timeline summary of a logged call: "Call — No answer · left a message". */
export function callLogSummary(outcome: CallLogOutcome, note?: string | null): string {
  const text = (note ?? "").trim();
  return `Call — ${CALL_OUTCOME_LABELS[outcome]}${text ? ` · ${text}` : ""}`;
}

/**
 * Stage after an inbound enquiry merges into an existing lead: a prospect we
 * had only contacted has now answered; every other stage is left alone.
 */
export function stageAfterInboundMerge(stage: LeadStage, incoming: LeadKind): LeadStage {
  return stage === "contacted" && isInboundKind(incoming) ? "replied" : stage;
}

/** Kinds the prospect initiated (forms, chat, bookings) as opposed to our outreach or a manual entry. */
export function isInboundKind(kind: LeadKind): boolean {
  return kind !== "outreach" && kind !== "manual";
}

// ---- merging ------------------------------------------------------------------

export const MERGE_WINDOW_DAYS = 180;

/** Merge rule for kinds: an existing lead only ever upgrades to booking. */
export function mergedKind(existing: LeadKind, incoming: LeadKind): LeadKind {
  return incoming === "booking" ? "booking" : existing;
}

/** Both SQL timestamps ("YYYY-MM-DD HH:MM:SS", UTC); true when they lie within 180 days of each other. */
export function withinMergeWindow(existingCreatedAt: string, incomingCreatedAt: string): boolean {
  const a = sqlToMs(existingCreatedAt);
  const b = sqlToMs(incomingCreatedAt);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= MERGE_WINDOW_DAYS * 86_400_000;
}

/** utm_campaign of a report CTA: the audit reference the prospect clicked from. */
export const AUDIT_CAMPAIGN_RE = /^AU-[23456789A-Z]{5}$/;
export const SEND_REFERENCE_RE = /^SN-[23456789A-Z]{5}$/;
export const LEAD_REFERENCE_RE = /^LD-[23456789A-Z]{5}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- display helpers ----------------------------------------------------------

/** "10 Sep 2026 14:03" in Europe/Paris, or "—". */
export function fmtDateTime(sql: string | null | undefined): string {
  const ms = sqlToMs(sql);
  if (ms === null) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** "10 Sep 2026" for a YYYY-MM-DD or SQL timestamp, or "—". */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = DATE_RE.test(value) ? Date.parse(`${value}T12:00:00Z`) : sqlToMs(value);
  if (ms === null || Number.isNaN(ms)) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
}

/** Whole days between a YYYY-MM-DD and today (negative = overdue). */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** Whole days elapsed since a SQL timestamp, or null when unset/invalid. */
export function daysSince(sql: string | null | undefined, now: Date): number | null {
  const ms = sqlToMs(sql);
  if (ms === null) return null;
  return Math.floor((now.getTime() - ms) / 86_400_000);
}

/** Today as YYYY-MM-DD in Europe/Paris — next_action_at is a civil date there, not a UTC one. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** How a follow-up date reads on the page, and whether it is late. */
export interface DueWords {
  text: string;
  overdue: boolean;
}

/**
 * "25 Sep 2026, in 4 days" · "25 Sep 2026 — today" · "was due 19 Sep 2026, 2 days ago".
 * Overdue is what turns the line amber; today is due but not late.
 */
export function dueWords(date: string, today: string): DueWords {
  const n = daysUntil(date, today);
  const when = fmtDate(date);
  if (n < 0) return { text: `was due ${when}, ${n === -1 ? "1 day" : `${-n} days`} ago`, overdue: true };
  if (n === 0) return { text: `${when} — today`, overdue: false };
  if (n === 1) return { text: `${when} — tomorrow`, overdue: false };
  return { text: `${when}, in ${n} days`, overdue: false };
}

/** YYYY-MM-DD `days` after a YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Display name for a lead: name and company, else the reference. */
export function leadTitle(lead: { name: string | null; company: string | null; reference: string }): string {
  const parts = [lead.name, lead.company].filter((s): s is string => !!s && s.trim().length > 0);
  return parts.length ? parts.join(" · ") : lead.reference;
}
