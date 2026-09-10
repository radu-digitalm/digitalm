// Opposition list (contract §9 "Opt-out"): hashed email / phone rows that are
// never purged, checked before every send and every call. Entries arrive from
// the /o/[token] page (link), the List-Unsubscribe one-click POST, a STOP
// reply recorded by send reference, a refused call, or a manual add. Raw
// addresses are hashed at once and never stored here; Telegram gets references
// only. Nothing touches the DB at module load.
import { hashEmail, hashPhone, localeForCountry, normaliseEmail, validEmail } from "@/lib/crm/classify";
import { sqlNow } from "@/lib/crm/time";
import type { Activity, Lead, LeadStage } from "@/lib/crm/types";
import { enquiriesDb } from "@/lib/enquiries";
import { addActivity, getLead, getLeadByReference, updateLead } from "@/lib/inbox/leads";
import { LEAD_REFERENCE_RE, SEND_REFERENCE_RE } from "@/lib/inbox/stages";
import { notifyTelegram } from "@/lib/notify";
import { getProspect, getProspectByReference } from "@/lib/prospects/store";
import { isOptoutToken } from "./optoutToken";

export type OptoutSource = "link" | "one_click" | "reply_stop" | "call" | "manual";
export type OptoutChannel = "email" | "phone" | "both";

/** Error with a stable code and HTTP status for the routes. */
export class OptoutError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "OptoutError";
    this.code = code;
    this.status = status;
  }
}

export interface OptoutRow {
  id: number;
  emailHash: string | null;
  phoneHash: string | null;
  channel: OptoutChannel;
  source: OptoutSource;
  leadId: number | null;
  prospectId: number | null;
  sendId: number | null;
  note: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function rowToOptout(r: Row): OptoutRow {
  const channel = str(r.channel);
  const source = str(r.source);
  return {
    id: Number(r.id),
    emailHash: str(r.email_hash),
    phoneHash: str(r.phone_hash),
    channel: channel === "phone" || channel === "both" ? channel : "email",
    source: source === "one_click" || source === "reply_stop" || source === "call" || source === "manual" ? source : "link",
    leadId: num(r.lead_id),
    prospectId: num(r.prospect_id),
    sendId: num(r.send_id),
    note: str(r.note),
    createdAt: String(r.created_at ?? ""),
  };
}

// ---- lookups -------------------------------------------------------------------------------------

/** True when either hash is on the list. Runs before every send and every call. */
export function isOptedOut(hashes: { emailHash?: string | null; phoneHash?: string | null }): boolean {
  const where: string[] = [];
  const params: string[] = [];
  if (hashes.emailHash) {
    where.push("email_hash = ?");
    params.push(hashes.emailHash);
  }
  if (hashes.phoneHash) {
    where.push("phone_hash = ?");
    params.push(hashes.phoneHash);
  }
  if (where.length === 0) return false;
  const row = enquiriesDb().prepare(`SELECT 1 AS hit FROM optouts WHERE ${where.join(" OR ")} LIMIT 1`).get(...params);
  return !!row;
}

/** Hashes of the contact details a prospect would be reached on (override first, like the send and call paths). */
export function prospectHashes(p: {
  country: string;
  contactEmailOverride: string | null;
  websiteEmail: string | null;
  sourceEmail: string | null;
  contactPhoneOverride: string | null;
  websitePhone: string | null;
  sourcePhone: string | null;
}): { emailHash: string | null; phoneHash: string | null; emailHashes: string[]; phoneHashes: string[] } {
  const emails = [p.contactEmailOverride, p.websiteEmail, p.sourceEmail].filter((e): e is string => !!e && validEmail(e));
  const phones = [p.contactPhoneOverride, p.websitePhone, p.sourcePhone].filter((s): s is string => !!s);
  const emailHashes = [...new Set(emails.map(hashEmail))];
  const phoneHashes = [...new Set(phones.map((s) => hashPhone(s, p.country)).filter((h): h is string => !!h))];
  return { emailHash: emailHashes[0] ?? null, phoneHash: phoneHashes[0] ?? null, emailHashes, phoneHashes };
}

/** Any of the prospect's known addresses or numbers on the list (or the prospect itself flagged). */
export function isProspectOptedOut(p: Parameters<typeof prospectHashes>[0] & { optedOutAt: string | null }): boolean {
  if (p.optedOutAt) return true;
  const h = prospectHashes(p);
  return h.emailHashes.some((emailHash) => isOptedOut({ emailHash })) || h.phoneHashes.some((phoneHash) => isOptedOut({ phoneHash }));
}

// ---- recording -----------------------------------------------------------------------------------

export interface RecordOptoutInput {
  emailHash?: string | null;
  phoneHash?: string | null;
  source: OptoutSource;
  leadId?: number | null;
  prospectId?: number | null;
  sendId?: number | null;
  note?: string | null;
  actor?: Activity["actor"];
}

export interface RecordOptoutResult {
  /** False when the same hash was already listed — nothing was written. */
  recorded: boolean;
  optout: OptoutRow;
  leadId: number | null;
  prospectId: number | null;
}

const CHANNEL_FOR_SOURCE: Record<OptoutSource, Activity["channel"]> = {
  link: "web",
  one_click: "web",
  reply_stop: "email",
  call: "phone",
  manual: null,
};

const SUMMARY: Record<OptoutSource, string> = {
  link: "Opt-out confirmed on the unsubscribe page",
  one_click: "Opt-out via one-click unsubscribe",
  reply_stop: "STOP reply recorded",
  call: "Refused on the phone — do not contact again",
  manual: "Added to the opposition list",
};

/**
 * Writes the opposition row (idempotent on the hashes), flags the prospect,
 * closes the lead with stage `stop`, records one `optout` activity and pings
 * Telegram with references only. Everything but the ping runs in one
 * transaction.
 */
export function recordOptout(input: RecordOptoutInput): RecordOptoutResult {
  const emailHash = input.emailHash || null;
  const phoneHash = input.phoneHash || null;
  if (!emailHash && !phoneHash) throw new OptoutError("nothing_to_list", 422);
  const db = enquiriesDb();
  const result = db.transaction((): RecordOptoutResult => {
    let prospectId = input.prospectId ?? null;
    let leadId = input.leadId ?? null;
    // Resolve the other side of the link when only one id is known.
    if (prospectId !== null && leadId === null) {
      const p = db.prepare("SELECT lead_id FROM prospects WHERE id = ?").get(prospectId) as { lead_id: number | null } | undefined;
      leadId = p?.lead_id ?? null;
    }
    if (leadId !== null && prospectId === null) {
      const l = db.prepare("SELECT prospect_id FROM leads WHERE id = ?").get(leadId) as { prospect_id: number | null } | undefined;
      prospectId = l?.prospect_id ?? null;
    }

    const where: string[] = [];
    const params: string[] = [];
    if (emailHash) {
      where.push("email_hash = ?");
      params.push(emailHash);
    }
    if (phoneHash) {
      where.push("phone_hash = ?");
      params.push(phoneHash);
    }
    const existing = db.prepare(`SELECT * FROM optouts WHERE ${where.join(" OR ")} ORDER BY id LIMIT 1`).get(...params) as Row | undefined;

    // The prospect and lead are flagged even on a repeat: a second request
    // from another path must never leave them contactable.
    if (prospectId !== null) {
      db.prepare("UPDATE prospects SET opted_out_at = COALESCE(opted_out_at, ?), updated_at = ? WHERE id = ?").run(sqlNow(), sqlNow(), prospectId);
    }
    if (leadId !== null) {
      const lead = getLead(leadId);
      if (lead && lead.stage !== "stop") updateLead(leadId, { stage: "stop" }, input.actor ?? "prospect");
    }
    if (existing) return { recorded: false, optout: rowToOptout(existing), leadId, prospectId };

    const channel: OptoutChannel = emailHash && phoneHash ? "both" : phoneHash ? "phone" : "email";
    const info = db
      .prepare("INSERT INTO optouts (email_hash, phone_hash, channel, source, lead_id, prospect_id, send_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(emailHash, phoneHash, channel, input.source, leadId, prospectId, input.sendId ?? null, input.note?.trim().slice(0, 300) || null, sqlNow());
    const optout = rowToOptout(db.prepare("SELECT * FROM optouts WHERE id = ?").get(Number(info.lastInsertRowid)) as Row);
    if (leadId !== null || prospectId !== null) {
      addActivity({
        leadId,
        prospectId,
        kind: "optout",
        channel: CHANNEL_FOR_SOURCE[input.source],
        summary: SUMMARY[input.source],
        payload: { source: input.source, channel },
        actor: input.actor ?? (input.source === "manual" ? "admin" : "prospect"),
      });
    }
    return { recorded: true, optout, leadId, prospectId };
  })();

  if (result.recorded) {
    const refs: string[] = [];
    if (result.prospectId !== null) {
      const p = db.prepare("SELECT reference FROM prospects WHERE id = ?").get(result.prospectId) as { reference: string } | undefined;
      if (p) refs.push(p.reference);
    }
    if (result.leadId !== null) {
      const l = db.prepare("SELECT reference FROM leads WHERE id = ?").get(result.leadId) as { reference: string } | undefined;
      if (l) refs.push(l.reference);
    }
    notifyTelegram(`Opt-out recorded (${input.source})${refs.length ? ` — ${refs.join(" · ")}` : ""}`);
  }
  return result;
}

// ---- the /o/[token] flow -------------------------------------------------------------------------

type SendRow = {
  id: number;
  reference: string;
  prospect_id: number;
  lead_id: number | null;
  to_email: string | null;
  to_hash: string | null;
  country: string;
  p_locale: string | null;
};

function sendByToken(token: string): SendRow | null {
  if (!isOptoutToken(token)) return null;
  const row = enquiriesDb()
    .prepare(
      `SELECT s.id, s.reference, s.prospect_id, s.lead_id, s.to_email, s.to_hash, s.country, p.locale AS p_locale
         FROM sends s LEFT JOIN prospects p ON p.id = s.prospect_id
        WHERE s.optout_token = ?`,
    )
    .get(token) as SendRow | undefined;
  return row ?? null;
}

export interface OptoutPageData {
  locale: "fr" | "en";
  /** The address behind this link is already on the list. */
  already: boolean;
}

/** What /o/[token] renders, or null (unknown token → 404). Language = the send's prospect locale. */
export function optoutPageData(token: string): OptoutPageData | null {
  const s = sendByToken(token);
  if (!s) return null;
  const hash = s.to_hash ?? (s.to_email ? hashEmail(s.to_email) : null);
  return {
    locale: s.p_locale === "fr" ? "fr" : s.p_locale === "en" ? "en" : localeForCountry(s.country),
    already: hash ? isOptedOut({ emailHash: hash }) : false,
  };
}

export type OptoutByTokenResult = { status: "invalid" } | { status: "recorded" | "already"; locale: "fr" | "en"; reference: string };

/** POST /api/o/[token]: list the address the email went to. Idempotent; tokens never expire. */
export function optoutByToken(token: string, source: "link" | "one_click"): OptoutByTokenResult {
  const s = sendByToken(token);
  if (!s) return { status: "invalid" };
  const emailHash = s.to_hash ?? (s.to_email ? hashEmail(s.to_email) : null);
  if (!emailHash) return { status: "invalid" };
  const locale: "fr" | "en" = s.p_locale === "fr" ? "fr" : s.p_locale === "en" ? "en" : localeForCountry(s.country);
  const r = recordOptout({ emailHash, source, leadId: s.lead_id, prospectId: s.prospect_id, sendId: s.id, actor: "prospect" });
  return { status: r.recorded ? "recorded" : "already", locale, reference: s.reference };
}

// ---- manual add (POST /api/admin/optouts) --------------------------------------------------------

export interface ManualOptoutResult {
  recorded: boolean;
  optout: OptoutRow;
  /** The lead closed with stage stop, when one exists. */
  lead: Lead | null;
}

/**
 * Accepts `{ email }`, `{ phone, country? }`, `{ lead_id }` or `{ lead_reference }`,
 * `{ prospect_id }` or `{ prospect_reference }`, or `{ send_reference, source: "reply_stop" }`.
 * Raw values are hashed at once; nothing raw is stored. Throws OptoutError.
 */
export function manualOptout(body: unknown): ManualOptoutResult {
  if (!body || typeof body !== "object") throw new OptoutError("bad_request", 400);
  const b = body as Record<string, unknown>;
  const note = typeof b.note === "string" ? b.note : null;
  const source: OptoutSource = b.source === "reply_stop" ? "reply_stop" : b.source === "call" ? "call" : "manual";
  const finish = (r: RecordOptoutResult): ManualOptoutResult => ({ recorded: r.recorded, optout: r.optout, lead: r.leadId !== null ? getLead(r.leadId) : null });

  if (typeof b.send_reference === "string") {
    const ref = b.send_reference.trim().toUpperCase();
    if (!SEND_REFERENCE_RE.test(ref)) throw new OptoutError("send_reference", 422);
    const s = enquiriesDb().prepare("SELECT id, prospect_id, lead_id, to_email, to_hash FROM sends WHERE reference = ?").get(ref) as
      | { id: number; prospect_id: number; lead_id: number | null; to_email: string | null; to_hash: string | null }
      | undefined;
    if (!s) throw new OptoutError("send_not_found", 404);
    const emailHash = s.to_hash ?? (s.to_email ? hashEmail(s.to_email) : null);
    if (!emailHash) throw new OptoutError("send_without_address", 422);
    return finish(recordOptout({ emailHash, source, leadId: s.lead_id, prospectId: s.prospect_id, sendId: s.id, note, actor: "admin" }));
  }

  if (typeof b.email === "string") {
    const email = normaliseEmail(b.email);
    if (!email) throw new OptoutError("email", 422);
    return finish(recordOptout({ emailHash: hashEmail(email), source, note, actor: "admin" }));
  }

  if (typeof b.phone === "string") {
    const country = typeof b.country === "string" && /^[A-Za-z]{2}$/.test(b.country.trim()) ? b.country.trim().toUpperCase() : "FR";
    const phoneHash = hashPhone(b.phone, country);
    if (!phoneHash) throw new OptoutError("phone", 422);
    return finish(recordOptout({ phoneHash, source, note, actor: "admin" }));
  }

  let lead: Lead | null = null;
  if (b.lead_id !== undefined) {
    const id = Number(b.lead_id);
    if (!Number.isInteger(id) || id <= 0) throw new OptoutError("lead_id", 422);
    lead = getLead(id);
    if (!lead) throw new OptoutError("lead_not_found", 404);
  } else if (typeof b.lead_reference === "string") {
    const ref = b.lead_reference.trim().toUpperCase();
    if (!LEAD_REFERENCE_RE.test(ref)) throw new OptoutError("lead_reference", 422);
    lead = getLeadByReference(ref);
    if (!lead) throw new OptoutError("lead_not_found", 404);
  }
  if (lead) {
    const prospect = lead.prospectId !== null ? getProspect(lead.prospectId) : null;
    const h = prospect ? prospectHashes(prospect) : { emailHash: null, phoneHash: null };
    const emailHash = lead.emailHash ?? h.emailHash;
    const phoneHash = lead.phoneHash ?? h.phoneHash;
    if (!emailHash && !phoneHash) throw new OptoutError("lead_without_contact", 422);
    return finish(recordOptout({ emailHash, phoneHash, source, leadId: lead.id, prospectId: lead.prospectId, note, actor: "admin" }));
  }

  let prospect = null;
  if (b.prospect_id !== undefined) {
    const id = Number(b.prospect_id);
    if (!Number.isInteger(id) || id <= 0) throw new OptoutError("prospect_id", 422);
    prospect = getProspect(id);
    if (!prospect) throw new OptoutError("prospect_not_found", 404);
  } else if (typeof b.prospect_reference === "string") {
    const ref = b.prospect_reference.trim().toUpperCase();
    prospect = getProspectByReference(ref);
    if (!prospect) throw new OptoutError("prospect_not_found", 404);
  }
  if (prospect) {
    const h = prospectHashes(prospect);
    if (!h.emailHash && !h.phoneHash) throw new OptoutError("prospect_without_contact", 422);
    return finish(recordOptout({ emailHash: h.emailHash, phoneHash: h.phoneHash, source, leadId: prospect.leadId, prospectId: prospect.id, note, actor: "admin" }));
  }

  throw new OptoutError("bad_request", 400);
}

// ---- list (/admin/optouts) ------------------------------------------------------------------------

export interface OptoutListRow extends OptoutRow {
  leadReference: string | null;
  leadStage: LeadStage | null;
  prospectReference: string | null;
  prospectName: string | null;
  sendReference: string | null;
}

export const OPTOUT_SORTS: Record<string, string> = {
  created: "o.created_at DESC, o.id DESC",
  oldest: "o.created_at ASC, o.id ASC",
  source: "o.source ASC, o.created_at DESC",
};

/** Newest first by default; hashes only, never an address. */
export function listOptouts(opts: { sort?: string; limit?: number; offset?: number } = {}): { rows: OptoutListRow[]; total: number } {
  const db = enquiriesDb();
  const order = typeof opts.sort === "string" && Object.hasOwn(OPTOUT_SORTS, opts.sort) ? OPTOUT_SORTS[opts.sort]! : OPTOUT_SORTS.created!;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT o.*, l.reference AS lead_reference, l.stage AS lead_stage, p.reference AS prospect_reference, p.name AS prospect_name, s.reference AS send_reference
         FROM optouts o
         LEFT JOIN leads l ON l.id = o.lead_id
         LEFT JOIN prospects p ON p.id = o.prospect_id
         LEFT JOIN sends s ON s.id = o.send_id
        ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Row[];
  const total = (db.prepare("SELECT COUNT(*) AS n FROM optouts").get() as { n: number }).n;
  return {
    rows: rows.map((r) => ({
      ...rowToOptout(r),
      leadReference: str(r.lead_reference),
      leadStage: (str(r.lead_stage) as LeadStage | null) ?? null,
      prospectReference: str(r.prospect_reference),
      prospectName: str(r.prospect_name),
      sendReference: str(r.send_reference),
    })),
    total,
  };
}
