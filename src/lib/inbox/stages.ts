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
 *
 * Six, not seven: nine stages less lost, no_response and stop. (The spec's
 * "seven forward stages" is an arithmetic slip — there is no seventh.)
 *
 * This list, nextForwardStage, nextMoveLabel, the two call-outcome tables,
 * parisToday, dueWords, addDays, activitySummary, activityPayloadLine and
 * leadErrorWords are the lead page's rules, and the page now reads all of them
 * from here. It is the one copy on purpose: a second copy is how the "+2 days"
 * chip came to compute its date in UTC while the page read it in Paris.
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
 *
 * Same five values in the same order as lib/outreach/calls.ts, so the two
 * boxes offer the same buttons in the same places and a habit learned on one
 * works on the other. See the blockers: calls.ts should read this list rather
 * than keep the copy.
 */
export const CALL_OUTCOMES = ["no_answer", "answered", "refused", "callback", "wrong_number"] as const;
export type CallLogOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallLogOutcome, string> = {
  no_answer: "No answer",
  answered: "Answered",
  refused: "Refused — do not call again",
  callback: "Call back",
  wrong_number: "Wrong number",
};

export function isCallLogOutcome(x: unknown): x is CallLogOutcome {
  return typeof x === "string" && (CALL_OUTCOMES as readonly string[]).includes(x);
}

/** Timeline summary of a logged call: "Call — No answer · left a message". */
export function callLogSummary(outcome: CallLogOutcome, note?: string | null): string {
  const text = (note ?? "").trim();
  return activitySummary(`Call — ${CALL_OUTCOME_LABELS[outcome]}${text ? ` · ${text}` : ""}`);
}

// ---- what a timeline row can hold ---------------------------------------------

/** activities.summary is stored at 500 characters (insertActivity slices it). */
export const ACTIVITY_SUMMARY_MAX = 500;

/**
 * A summary the store will keep whole. The routes build the line, the store
 * cuts it at 500 without saying so; cutting it here instead means a long note
 * ends in an ellipsis rather than mid-word, and the row Radu reads back is the
 * row the route decided to write.
 */
export function activitySummary(text: string): string {
  const s = text.trim();
  return s.length <= ACTIVITY_SUMMARY_MAX ? s : `${s.slice(0, ACTIVITY_SUMMARY_MAX - 1).trimEnd()}…`;
}

// ---- a timeline row's payload, in words ---------------------------------------

/** A stored token: lower case, words joined by underscores ("no_answer", "stage_change"). */
const STORED_TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** "no_answer" → "No answer", for a key or a value nothing else has words for. */
function tokenWords(token: string): string {
  const s = token.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One line of an activity's payload as a person reads it: "Outcome: No answer",
 * "From: Replied", "To: No response". The payload is stored in codes — the
 * `call` row keeps {outcome}, a stage change keeps {from, to} — and a code on
 * Radu's screen is a banned token (components/admin/wording.ts §7), so the
 * renderer asks here instead of printing `${key}: ${value}`.
 *
 * Returns null for anything not worth a line (empty, nested, the IP hash).
 */
export function activityPayloadLine(key: string, value: unknown): string | null {
  if (key === "ipHash" || value === null || value === undefined || value === "" || typeof value === "object" || typeof value === "function") return null;
  const raw = typeof value === "string" ? value : String(value);
  if (!raw.trim()) return null;
  let words = raw;
  if (isLeadStage(raw)) words = STAGE_LABELS[raw];
  else if (isCallLogOutcome(raw)) words = CALL_OUTCOME_LABELS[raw];
  else if (isLeadKind(raw)) words = KIND_LABELS[raw];
  else if (STORED_TOKEN.test(raw)) words = tokenWords(raw);
  return `${STORED_TOKEN.test(key) ? tokenWords(key) : key.charAt(0).toUpperCase() + key.slice(1)}: ${words}`;
}

// ---- failures in words --------------------------------------------------------

/**
 * Every code the lead page's three routes can answer with, in words:
 *   /api/admin/leads/[id] and .../activity   (the lead's own two)
 *   /api/admin/optouts                       ("Mark STOP" writes there first)
 *   /api/admin/prospects/[id]/manual-send    ("Sent from Gmail", in Details)
 * The codes stay short so the log stays greppable, and none of them belongs on
 * a screen: `\b[a-z]+_[a-z_]+\b` and `http_` are both banned tokens in the
 * admin (components/admin/wording.ts), and "Bounce recorded failed:
 * send_not_found" is exactly what that ban exists to stop. Anything the lead
 * page posts reads its toast from here.
 *
 * Object.create(null): a plain literal answers to "toString" and "constructor"
 * with a function, and `??` does not catch that — the toast would read
 * "function toString() { [native code] }".
 */
export const LEAD_ERROR_WORDS: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  // the lead routes
  bad_id: "This lead is no longer in the database — reload the page.",
  not_found: "This lead is no longer in the database — reload the page.",
  bad_request: "The page sent something the server could not read.",
  bad_merge: "Those two leads cannot be folded into one.",
  stage: "That is not one of the nine stages.",
  next_action_at: "That date could not be read.",
  email: "That address does not look right.",
  empty: "Nothing to save.",
  kind: "This page asked for something the server does not do.",
  text: "Type something first.",
  outcome: "Pick what happened on the call first.",
  send_reference: "A send reference looks like SN-ABCDE.",
  send_not_found: "No send with that reference.",
  // the opposition list (Mark STOP)
  phone: "That number could not be read.",
  lead_id: "The page named a lead the server could not read.",
  lead_reference: "A lead reference looks like LD-ABCDE.",
  lead_not_found: "No lead with that reference.",
  lead_without_contact: "This lead has no address and no number to add.",
  prospect_id: "The page named a prospect the server could not read.",
  prospect_not_found: "No prospect with that reference.",
  prospect_without_contact: "That prospect has no address and no number to add.",
  send_without_address: "That send has no recipient on record.",
  nothing_to_list: "There is nothing here to add to the opposition list.",
  note_contains_contact: "The note must not carry an address or a number — the opposition list is never purged.",
  // the manual-send route (Sent from Gmail)
  draft_id: "That follow-up template could not be read.",
  draft_not_found: "That follow-up template is no longer there.",
  send_id: "That send could not be read.",
  action: "This page asked for something the server does not do.",
  not_sent: "That email was never sent, so it cannot be marked.",
  not_prepared: "That email was not prepared — start again.",
  legal_block_incomplete: "The legal block is incomplete, so the email cannot go out.",
  optout_listed: "They are on the opposition list — no more contact.",
  smtp_failed: "The mail server would not take it, so nothing was sent.",
  refused: "The sending rules refused this one — the prospect page says why.",
  // the guard and the last resort
  unauthorized: "The session has expired — sign in again.",
  csrf: "The session check failed — reload the page.",
  server_error: "The server had a problem. Try again in a minute.",
});

export const LEAD_ERROR_FALLBACK = "It did not go through. Try again.";

/**
 * An error whose message is already the sentence to show. A handler that
 * composes its own words (a STOP whose stage moved while the opposition list
 * did not) throws one of these; leadErrorWords hands the message straight back
 * instead of reading it as a route code. Nothing else is ever passed through:
 * a raw server string is where a banned token gets on the screen.
 */
export class LeadWordsError extends Error {
  constructor(words: string) {
    super(words);
    this.name = "LeadWordsError";
  }
}

function isWorded(e: unknown): e is Error {
  return e instanceof LeadWordsError || (e instanceof Error && e.name === "LeadWordsError");
}

/**
 * The sentence for whatever adminFetch threw — never the code itself, and
 * never the `http_<status>` it falls back to for a body it could not read.
 * Three paths: a sentence we composed, a code we have words for, and the
 * manual-send refusal, whose `error` is a whole sentence with the code in the
 * body next to it.
 */
export function leadErrorWords(e: unknown): string {
  if (isWorded(e)) return e.message;
  const code = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (Object.hasOwn(LEAD_ERROR_WORDS, code)) return LEAD_ERROR_WORDS[code];
  const body = e && typeof e === "object" ? (e as { body?: unknown }).body : undefined;
  const bodyCode = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  if (typeof bodyCode === "string" && Object.hasOwn(LEAD_ERROR_WORDS, bodyCode)) return LEAD_ERROR_WORDS[bodyCode];
  return LEAD_ERROR_FALLBACK;
}

/**
 * "Mark STOP" is two calls: the opposition list, then the stage. The stage
 * follows even when the list refuses, so a STOP is never lost — and the toast
 * then has to say both halves, in words, without naming the code that failed.
 * The sentence lives here, next to the words it ends with, so one test keeps
 * both clear of the tokens the admin bans.
 */
export function stopPartlyDoneWords(e: unknown): string {
  return `The stage is now STOP. The opposition list was not updated: ${leadErrorWords(e)}`;
}

/** The same sentence to throw, for a caller that reports failures by throwing. */
export function stopPartlyDone(e: unknown): LeadWordsError {
  return new LeadWordsError(stopPartlyDoneWords(e));
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
