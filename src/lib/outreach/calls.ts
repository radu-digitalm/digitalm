// Call log (contract §9 "Calls"): before an outcome is written the register
// is re-checked (unless checked in the last 24 h), then the opposition list,
// the rule's calling hours, the 4-per-30-days counter and — for GB — the
// TPS/CTPS screening are evaluated. GB stays "screened" and every country
// without its own rule is "manual" (Appendix F): the panel warns and still
// logs. Nothing touches the DB at module load.
import { HttpError } from "@/lib/crm/http";
import { sqlToMs, toSql } from "@/lib/crm/time";
import type { CallPolicy, Lead, Refusal } from "@/lib/crm/types";
import { latestDraft } from "@/lib/drafts/store";
import type { PhoneSource } from "@/lib/drafts/templates";
import { enquiriesDb } from "@/lib/enquiries";
import { followUpDate } from "@/lib/inbox/hooks";
import { addActivity, ensureLeadForProspect, getLead, updateLead } from "@/lib/inbox/leads";
import { getProspect, type ProspectRecord } from "@/lib/prospects/store";
import { recheckRegister, type RegisterCheck } from "@/lib/prospects/registerCheck";
import { CALL_OPENERS, PHONE_SOURCES } from "@/content/outreach";
import { isProspectOptedOut, noteCarriesContact, prospectHashes, recordOptout } from "./optout";
import { TPS_VALID_DAYS, evaluateCallRefusals, screeningValid } from "./refusals";
import { callWindowStatus, ruleFor, ruleKeyFor, type RuleKey, type WindowStatus } from "./rules";

export type CallOutcome = "no_answer" | "answered" | "refused" | "callback" | "wrong_number";
export const CALL_OUTCOMES: readonly CallOutcome[] = ["no_answer", "answered", "refused", "callback", "wrong_number"];

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No answer",
  answered: "Answered",
  refused: "Refused — do not call again",
  callback: "Call back",
  wrong_number: "Wrong number",
};

export function isCallOutcome(x: unknown): x is CallOutcome {
  return typeof x === "string" && (CALL_OUTCOMES as readonly string[]).includes(x);
}

/** Error with a stable code and HTTP status for the routes. */
export class CallError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "CallError";
    this.code = code;
    this.status = status;
  }
}

const RECHECK_AFTER_MS = 24 * 3_600_000;

// ---- facts ----------------------------------------------------------------------------------------

/** `call` activities on the prospect in the last 30 days — the same count CALL_WHERE uses. */
export function callAttempts30d(prospectId: number): number {
  return (
    enquiriesDb().prepare("SELECT COUNT(*) AS n FROM activities WHERE prospect_id = ? AND kind = 'call' AND created_at > datetime('now', '-30 days')").get(prospectId) as { n: number }
  ).n;
}

/** The number to dial and where it came from (override first, then the site, then the discovery tag). */
export function phoneFor(p: ProspectRecord): { number: string | null; source: PhoneSource | null } {
  if (p.contactPhoneOverride) return { number: p.contactPhoneOverride, source: "manual" };
  if (p.websitePhone) return { number: p.websitePhone, source: "website" };
  if (p.sourcePhone) {
    const s = p.source;
    return { number: p.sourcePhone, source: s === "osm" || s === "fr_register" || s === "companies_house" || s === "google" || s === "manual" ? s : null };
  }
  return { number: null, source: null };
}

/** The opener lines in the prospect's language with the number's source filled in. */
export function openersFor(locale: "fr" | "en", source: PhoneSource | null): string[] {
  const words = PHONE_SOURCES[source ?? "manual"][locale];
  return CALL_OPENERS[locale].map((line) => line.replace("{phone_source}", words));
}

async function registerCheckIfDue(p: ProspectRecord): Promise<RegisterCheck | null> {
  const ms = sqlToMs(p.registerCheckedAt);
  if (ms !== null && Date.now() - ms < RECHECK_AFTER_MS) return null;
  try {
    return await recheckRegister(p);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : "register_check_failed";
    throw new CallError(`register_check_failed:${code}`, 503);
  }
}

// ---- panel state ------------------------------------------------------------------------------------

export interface CallPanelState {
  prospect: {
    id: number;
    reference: string;
    name: string;
    country: string;
    locale: "fr" | "en";
    leadId: number | null;
    leadStage: string | null;
    registerStatus: string;
    registerCheckedAt: string | null;
    lastCalledAt: string | null;
    tpsCheckedAt: string | null;
    optedOutAt: string | null;
  };
  rule: { key: RuleKey; callAllowed: CallPolicy; tz: string; hours: string; maxAttempts: number };
  window: WindowStatus;
  phone: { number: string | null; source: PhoneSource | null };
  attempts30d: number;
  screening: { required: boolean; valid: boolean; checkedAt: string | null; validDays: number };
  openers: string[];
  script: string | null;
  /** Refusals as things stand (no checkbox, stored register status). */
  refusals: Refusal[];
  recentCalls: { id: number; summary: string; createdAt: string; outcome: string | null }[];
}

/** What CallPanel self-loads from GET /api/admin/prospects/[id]/call. No network calls here. */
export function callPanelState(prospectId: number, now = new Date()): CallPanelState {
  const p = getProspect(prospectId);
  if (!p || p.deletedAt) throw new CallError("prospect_not_found", 404);
  const rule = ruleFor(p.country);
  const window = callWindowStatus(rule.callWindow, now);
  const attempts30d = callAttempts30d(prospectId);
  const phone = phoneFor(p);
  const draft = latestDraft(prospectId);
  const lead = p.leadId !== null ? getLead(p.leadId) : null;
  const refusals = evaluateCallRefusals({ prospect: p, rule, optedOut: isProspectOptedOut(p), attempts30d, tpsChecked: false, registerCheck: null, now });
  const recent = enquiriesDb()
    .prepare("SELECT id, summary, payload, created_at FROM activities WHERE prospect_id = ? AND kind = 'call' ORDER BY created_at DESC, id DESC LIMIT 8")
    .all(prospectId) as { id: number; summary: string; payload: string | null; created_at: string }[];
  return {
    prospect: {
      id: p.id,
      reference: p.reference,
      name: p.name,
      country: p.country,
      locale: p.locale,
      leadId: p.leadId,
      leadStage: lead?.stage ?? null,
      registerStatus: p.registerStatus,
      registerCheckedAt: p.registerCheckedAt,
      lastCalledAt: p.lastCalledAt,
      tpsCheckedAt: p.tpsCheckedAt,
      optedOutAt: p.optedOutAt,
    },
    rule: { key: ruleKeyFor(p.country), callAllowed: rule.callAllowed, tz: rule.callWindow.tz, hours: window.hours, maxAttempts: rule.maxCallAttempts30d },
    window,
    phone,
    attempts30d,
    screening: { required: rule.callAllowed === "screened", valid: screeningValid(p.tpsCheckedAt, now), checkedAt: p.tpsCheckedAt, validDays: TPS_VALID_DAYS },
    openers: openersFor(p.locale, phone.source),
    script: draft?.callScript || null,
    refusals,
    recentCalls: recent.map((r) => {
      let outcome: string | null = null;
      try {
        const payload = r.payload ? (JSON.parse(r.payload) as { outcome?: unknown }) : null;
        outcome = typeof payload?.outcome === "string" ? payload.outcome : null;
      } catch {
        outcome = null;
      }
      return { id: r.id, summary: r.summary, createdAt: r.created_at, outcome };
    }),
  };
}

// ---- log ---------------------------------------------------------------------------------------------

export interface LogCallInput {
  prospectId: number;
  outcome: CallOutcome;
  note?: string | null;
  /** GB: the owner attests the number was screened against TPS and CTPS today. */
  tpsChecked?: boolean;
  /** Injected by tests; the routes leave it unset. */
  now?: Date;
}

export type LogCallResult = { ok: true; activityId: number; lead: Lead | null; optedOut: boolean } | { ok: false; refusals: Refusal[] };

/**
 * Log one call attempt. Steps in the contract's order: register re-check
 * (24 h), screening attestation written first when ticked, then the refusal
 * engine, then the activity and the prospect / lead effects per outcome.
 */
export async function logCall(input: LogCallInput): Promise<LogCallResult> {
  let p = getProspect(input.prospectId);
  if (!p || p.deletedAt) throw new CallError("prospect_not_found", 404);
  const registerCheck = await registerCheckIfDue(p);
  if (registerCheck?.checked) p = getProspect(input.prospectId) ?? p;
  const rule = ruleFor(p.country);
  const db = enquiriesDb();
  const now = input.now ?? new Date();
  const nowSql = toSql(now);

  if (input.tpsChecked && rule.callAllowed === "screened") {
    db.prepare("UPDATE prospects SET tps_checked_at = ?, updated_at = ? WHERE id = ?").run(nowSql, nowSql, p.id);
    p = { ...p, tpsCheckedAt: nowSql };
  }

  const refusals = evaluateCallRefusals({
    prospect: p,
    rule,
    optedOut: isProspectOptedOut(p),
    attempts30d: callAttempts30d(p.id),
    tpsChecked: !!input.tpsChecked,
    registerCheck: registerCheck?.checked ? { registerStatus: registerCheck.registerStatus, diffusion: registerCheck.diffusion } : null,
    now,
  });
  if (refusals.length) return { ok: false, refusals };

  const note = (input.note ?? "").trim().slice(0, 500);
  // A refusal's note lands in `optouts`, which the purge never touches: no address or number in it.
  if (input.outcome === "refused" && noteCarriesContact(note)) throw new CallError("note_contains_contact", 422);
  const prospect = p;
  return db.transaction((): LogCallResult => {
    // A call is a contact attempt: the lead exists from the first one.
    const nextFor: Record<CallOutcome, { action: string; at: string } | null> = {
      no_answer: { action: "Call again", at: followUpDate(1) },
      answered: { action: "Follow up after the call", at: followUpDate(7) },
      callback: { action: "Call back", at: followUpDate(1) },
      refused: null,
      wrong_number: null,
    };
    const next = nextFor[input.outcome];
    let lead: Lead | null = ensureLeadForProspect(prospect.id, { kind: "outreach", stage: "contacted", nextAction: next?.action ?? "Call", nextActionAt: next?.at ?? followUpDate(1) });
    if (lead.stage === "new") lead = updateLead(lead.id, { stage: "contacted" }, "admin") ?? lead;
    if (next && (input.outcome !== "answered" || !lead.nextActionAt)) lead = updateLead(lead.id, { nextAction: next.action, nextActionAt: next.at }, "admin") ?? lead;

    const activity = addActivity({
      leadId: lead.id,
      prospectId: prospect.id,
      kind: "call",
      channel: "phone",
      summary: `Call · ${OUTCOME_LABELS[input.outcome]}${note ? ` — ${note}` : ""}`,
      payload: { outcome: input.outcome },
      actor: "admin",
    });
    db.prepare("UPDATE prospects SET last_called_at = ?, updated_at = ? WHERE id = ?").run(nowSql, nowSql, prospect.id);

    let optedOut = false;
    if (input.outcome === "answered") {
      // The opener lines carry the layered notice — identity, source of the
      // number, purpose, right to refuse, and the pointer to the full notice
      // (CALL_OPENERS, fifth line): the first spoken contact counts as informed.
      db.prepare("UPDATE prospects SET notice_sent_at = COALESCE(notice_sent_at, ?) WHERE id = ?").run(nowSql, prospect.id);
      db.prepare("UPDATE leads SET notice_sent_at = COALESCE(notice_sent_at, ?) WHERE id = ?").run(nowSql, lead.id);
    }
    if (input.outcome === "refused") {
      // Every address and number the prospect is known by goes on the list —
      // the list must outlive the prospect row and any re-discovery.
      const h = prospectHashes(prospect);
      if (h.emailHashes.length || h.phoneHashes.length) {
        recordOptout({ emailHashes: h.emailHashes, phoneHashes: h.phoneHashes, source: "call", leadId: lead.id, prospectId: prospect.id, note: note || null, actor: "prospect" });
      } else {
        db.prepare("UPDATE prospects SET opted_out_at = COALESCE(opted_out_at, ?), updated_at = ? WHERE id = ?").run(nowSql, nowSql, prospect.id);
        updateLead(lead.id, { stage: "stop" }, "prospect");
      }
      optedOut = true;
      lead = getLead(lead.id);
    }
    return { ok: true, activityId: activity.id, lead, optedOut };
  })();
}
