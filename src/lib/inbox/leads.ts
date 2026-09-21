// Leads and activities store (contract §5). Every write goes through here: the
// five public-route hooks, the admin routes, outreach's ensureLeadForProspect,
// the backfill. Timestamps are SQL "YYYY-MM-DD HH:MM:SS" (UTC) like the rest
// of the CRM; next_action_at is a civil date (YYYY-MM-DD, Europe/Paris).
// Sort identifiers come from a fixed allowlist, values go through `?`, LIKE
// terms are escaped with ESCAPE '\'. Nothing here touches the DB at load.
import { enquiriesDb } from "@/lib/enquiries";
import { allowed } from "@/lib/crm/allowlist";
import { newReference } from "@/lib/crm/refs";
import { parseJson } from "@/lib/crm/db";
import { sqlNow } from "@/lib/crm/time";
import { hashEmail, hashPhone } from "@/lib/crm/classify";
import { attributionLabel, type Attribution } from "@/lib/attribution";
import type { Activity, ActivityKind, Lead, LeadKind, LeadStage } from "@/lib/crm/types";
import {
  AUDIT_CAMPAIGN_RE,
  CLOSED_STAGES,
  KIND_LABELS,
  STAGE_LABELS,
  isLeadKind,
  isLeadStage,
  mergedKind,
  stageAfterInboundMerge,
  stageAfterReply,
  stagePatch,
  withinMergeWindow,
} from "./stages";

type Db = ReturnType<typeof enquiriesDb>;

// ---- rows -----------------------------------------------------------------------

type LeadRow = {
  id: number;
  reference: string;
  kind: string;
  stage: string;
  name: string | null;
  company: string | null;
  email: string | null;
  email_hash: string | null;
  phone: string | null;
  phone_hash: string | null;
  locale: string;
  country: string;
  source_label: string | null;
  source_utm: string | null;
  attribution: string | null;
  enquiry_reference: string | null;
  prospect_id: number | null;
  legal_basis: string;
  data_source: string;
  notice_sent_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  note: string | null;
  last_activity_at: string;
  replied_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  ip: string | null;
  browser_country?: string | null;
  browser_tz?: string | null;
  created_at: string;
  updated_at: string;
};

type ActivityRow = {
  id: number;
  lead_id: number | null;
  prospect_id: number | null;
  kind: string;
  channel: string | null;
  summary: string;
  payload: string | null;
  actor: string;
  created_at: string;
};

// `ip` is written on every row and was unreachable: no SELECT listed it, so the
// lead page could not show where the click came from. It is a real column, so
// it sits in the base list.
const LEAD_COLUMNS =
  "id, reference, kind, stage, name, company, email, email_hash, phone, phone_hash, locale, country, source_label, source_utm, attribution, enquiry_reference, prospect_id, legal_basis, data_source, notice_sent_at, next_action, next_action_at, note, last_activity_at, replied_at, closed_at, close_reason, ip, created_at, updated_at";

// Columns added by a later schema pass (the browser's own hints). A database
// that predates them must still open, so every statement asks the table what it
// has rather than assuming. Missing ones read null and the page says so.
const OPTIONAL_LEAD_COLUMNS = ["browser_country", "browser_tz"];
const OPTIONAL_ENQUIRY_COLUMNS = ["call_questions", "unknowns", "no_fit", "browser_country", "browser_tz"];
const presentColumns = new WeakMap<object, Map<string, string[]>>();

function columnsPresent(db: Db, table: string, wanted: string[]): string[] {
  let byTable = presentColumns.get(db as unknown as object);
  if (!byTable) {
    byTable = new Map();
    presentColumns.set(db as unknown as object, byTable);
  }
  const hit = byTable.get(table);
  if (hit) return hit.filter((c) => wanted.includes(c));
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
  byTable.set(table, have);
  return have.filter((c) => wanted.includes(c));
}

/** The SELECT list for a lead row, with whichever optional columns exist. */
function leadColumns(db: Db): string {
  const extra = columnsPresent(db, "leads", OPTIONAL_LEAD_COLUMNS);
  return extra.length ? `${LEAD_COLUMNS}, ${extra.join(", ")}` : LEAD_COLUMNS;
}

/**
 * A lead row as the store reads it: the shared `Lead` contract plus the three
 * columns only this module and the lead page use. `Lead` itself is not widened
 * because it is another unit's file (see the blockers in the unit report).
 */
export interface LeadRecord extends Lead {
  /** Written on every inbound row, nulled by the purge at 12 months. */
  ip: string | null;
  /** What the visitor's own browser reported. The only value allowed to name a country. */
  browserCountry: string | null;
  browserTz: string | null;
}

function rowToLead(r: LeadRow): LeadRecord {
  return {
    id: r.id,
    reference: r.reference,
    kind: (isLeadKind(r.kind) ? r.kind : "manual") as LeadKind,
    stage: (isLeadStage(r.stage) ? r.stage : "new") as LeadStage,
    name: r.name,
    company: r.company,
    email: r.email,
    emailHash: r.email_hash,
    phone: r.phone,
    phoneHash: r.phone_hash,
    locale: r.locale === "fr" ? "fr" : "en",
    country: r.country,
    sourceLabel: r.source_label,
    sourceUtm: r.source_utm,
    attribution: parseJson<Attribution | null>(r.attribution, null),
    enquiryReference: r.enquiry_reference,
    prospectId: r.prospect_id,
    legalBasis: r.legal_basis === "legitimate_interest" ? "legitimate_interest" : "request",
    dataSource: r.data_source as Lead["dataSource"],
    noticeSentAt: r.notice_sent_at,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at,
    note: r.note,
    lastActivityAt: r.last_activity_at,
    repliedAt: r.replied_at,
    closedAt: r.closed_at,
    closeReason: r.close_reason,
    ip: r.ip ?? null,
    browserCountry: r.browser_country ?? null,
    browserTz: r.browser_tz ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToActivity(r: ActivityRow): Activity {
  return {
    id: r.id,
    leadId: r.lead_id,
    prospectId: r.prospect_id,
    kind: r.kind as ActivityKind,
    channel: r.channel as Activity["channel"],
    summary: r.summary,
    payload: parseJson<Record<string, unknown> | null>(r.payload, null),
    actor: r.actor as Activity["actor"],
    createdAt: r.created_at,
  };
}

function readLead(db: Db, id: number): LeadRecord | null {
  const row = db.prepare(`SELECT ${leadColumns(db)} FROM leads WHERE id = ?`).get(id) as LeadRow | undefined;
  return row ? rowToLead(row) : null;
}

const CLOSED_LIST = CLOSED_STAGES.map((s) => `'${s}'`).join(", ");

// ---- normalisation ---------------------------------------------------------------

function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, max);
  return s || null;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, max);
  return s || null;
}

/** Lower-cased, trimmed address kept as typed; the hash is what merging uses. */
function cleanEmail(v: unknown): string | null {
  const s = clean(v, 254)?.toLowerCase() ?? null;
  return s && s.includes("@") ? s : null;
}

/** Country for phone normalisation when only the locale is known: fr → FR, else GB. */
export function countryForLocale(locale: string | null | undefined): string {
  return locale === "fr" ? "FR" : "GB";
}

function normaliseLocale(v: unknown): "fr" | "en" {
  return typeof v === "string" && v.trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

// ---- activities -----------------------------------------------------------------

export interface ActivityInput {
  leadId?: number | null;
  prospectId?: number | null;
  kind: ActivityKind;
  channel?: Activity["channel"];
  summary: string;
  payload?: Record<string, unknown> | null;
  actor?: Activity["actor"];
  createdAt?: string;
}

// Kinds that count as contact with the person: enquiries.last_contact_at moves
// so the retention purge (3 years after last contact) measures from them.
const CONTACT_KINDS = new Set<ActivityKind>(["email_out", "email_in", "call", "manual_send"]);

function insertActivity(db: Db, input: ActivityInput): Activity {
  let leadId = input.leadId ?? null;
  if (leadId === null && input.prospectId != null) {
    // Prospect-level events (report views, sends, calls) land on the prospect's lead when it has one.
    const viaProspect = db.prepare("SELECT lead_id FROM prospects WHERE id = ?").get(input.prospectId) as { lead_id: number | null } | undefined;
    const viaLeads = db.prepare("SELECT id FROM leads WHERE prospect_id = ? ORDER BY id LIMIT 1").get(input.prospectId) as { id: number } | undefined;
    leadId = viaProspect?.lead_id ?? viaLeads?.id ?? null;
  }
  const createdAt = input.createdAt ?? sqlNow();
  const info = db
    .prepare("INSERT INTO activities (lead_id, prospect_id, kind, channel, summary, payload, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      leadId,
      input.prospectId ?? null,
      input.kind,
      input.channel ?? null,
      input.summary.slice(0, 500),
      input.payload && Object.keys(input.payload).length ? JSON.stringify(input.payload) : null,
      input.actor ?? "admin",
      createdAt,
    );
  const id = Number(info.lastInsertRowid);
  if (leadId !== null) {
    db.prepare("UPDATE leads SET last_activity_at = MAX(last_activity_at, ?), updated_at = ? WHERE id = ?").run(createdAt, sqlNow(), leadId);
    if (CONTACT_KINDS.has(input.kind)) {
      const lead = db.prepare("SELECT enquiry_reference FROM leads WHERE id = ?").get(leadId) as { enquiry_reference: string | null } | undefined;
      if (lead?.enquiry_reference) {
        db.prepare("UPDATE enquiries SET last_contact_at = datetime('now') WHERE reference = ?").run(lead.enquiry_reference);
      }
    }
  }
  return rowToActivity(db.prepare("SELECT * FROM activities WHERE id = ?").get(id) as ActivityRow);
}

/**
 * Records an activity on a lead and/or prospect, bumps leads.last_activity_at
 * and, for email_out|email_in|call|manual_send on a lead that came from a
 * diagnostic, moves enquiries.last_contact_at (contract §5).
 */
export function addActivity(input: ActivityInput): Activity {
  const db = enquiriesDb();
  return db.transaction(() => insertActivity(db, input))();
}

/** Timeline of a lead: its own activities plus the prospect-level ones not tied to another lead. */
export function listActivities(leadId: number, prospectId: number | null, limit = 200): Activity[] {
  const db = enquiriesDb();
  const rows = (
    prospectId === null
      ? db.prepare("SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(leadId, limit)
      : db
          .prepare("SELECT * FROM activities WHERE lead_id = ? OR (prospect_id = ? AND lead_id IS NULL) ORDER BY created_at DESC, id DESC LIMIT ?")
          .all(leadId, prospectId, limit)
  ) as ActivityRow[];
  return rows.map(rowToActivity);
}

// ---- insert + merge -------------------------------------------------------------

export interface LeadInput {
  kind: LeadKind;
  stage?: LeadStage;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string | null;
  country?: string | null;
  sourceLabel?: string | null;
  sourceUtm?: string | null;
  attribution?: Attribution | null;
  enquiryReference?: string | null;
  prospectId?: number | null;
  legalBasis?: Lead["legalBasis"];
  dataSource?: Lead["dataSource"];
  noticeSentAt?: string | null;
  nextAction?: string | null;
  nextActionAt?: string | null;
  note?: string | null;
  ip?: string | null;
  /** ISO 3166-1 alpha-2 the visitor's own browser reported (time zone, then languages). */
  browserCountry?: string | null;
  /** The visitor's IANA time zone, for their local hour. */
  browserTz?: string | null;
  /** SQL timestamp; the backfill passes the enquiry's own created_at. */
  createdAt?: string;
}

const CHANNEL_FOR_KIND: Record<LeadKind, Activity["channel"]> = {
  diagnostic: "web",
  booking: "web",
  contact: "web",
  chat: "web",
  messenger: "web",
  outreach: "email",
  manual: null,
};

function findMergeTarget(db: Db, emailHash: string | null, phoneHash: string | null, createdAt: string): LeadRow | null {
  // Email first; phone only for phone-only enquiries (contract §5).
  const column = emailHash ? "email_hash" : phoneHash ? "phone_hash" : null;
  const value = emailHash ?? phoneHash;
  if (!column || !value) return null;
  const rows = db
    .prepare(`SELECT ${leadColumns(db)} FROM leads WHERE ${column} = ? AND stage NOT IN (${CLOSED_LIST}) ORDER BY created_at DESC LIMIT 10`)
    .all(value) as LeadRow[];
  return rows.find((r) => withinMergeWindow(r.created_at, createdAt)) ?? null;
}

/**
 * Inserts a lead, or merges it into an open lead with the same email hash
 * (phone hash when phone-only) created within 180 days: one `merged`
 * activity, kind upgraded only to booking, earliest created_at kept, empty
 * fields filled, an outreach lead that was only `contacted` moves to
 * `replied` when the person writes in.
 */
export function insertLead(input: LeadInput): { lead: LeadRecord; merged: boolean } {
  const db = enquiriesDb();
  const now = sqlNow();
  const createdAt = input.createdAt ?? now;
  const locale = normaliseLocale(input.locale);
  const country = clean(input.country, 2)?.toUpperCase() ?? countryForLocale(locale);
  const email = cleanEmail(input.email);
  const phone = clean(input.phone, 50);
  const emailHash = email ? hashEmail(email) : null;
  const phoneHash = phone ? hashPhone(phone, country) : null;
  const name = clean(input.name, 200);
  const company = clean(input.company, 200);
  const note = cleanText(input.note, 4000);
  const nextAction = clean(input.nextAction, 200);
  const nextActionAt = clean(input.nextActionAt, 10);
  const sourceLabel = clean(input.sourceLabel, 200);
  const sourceUtm = clean(input.sourceUtm, 100);
  const attribution = input.attribution && Object.keys(input.attribution).length ? JSON.stringify(input.attribution) : null;
  const enquiryReference = clean(input.enquiryReference, 20);
  const prospectId = input.prospectId ?? null;
  const browserCountry = clean(input.browserCountry, 2)?.toUpperCase() ?? null;
  const browserTz = clean(input.browserTz, 64);

  return db.transaction(() => {
    const existing = findMergeTarget(db, emailHash, phoneHash, createdAt);
    if (existing) {
      const kind = mergedKind(existing.kind as LeadKind, input.kind);
      db.prepare(
        `UPDATE leads SET
           kind = ?,
           name = COALESCE(name, ?), company = COALESCE(company, ?),
           email = COALESCE(email, ?), email_hash = COALESCE(email_hash, ?),
           phone = COALESCE(phone, ?), phone_hash = COALESCE(phone_hash, ?),
           enquiry_reference = COALESCE(enquiry_reference, ?), prospect_id = COALESCE(prospect_id, ?),
           source_label = COALESCE(source_label, ?), source_utm = COALESCE(source_utm, ?), attribution = COALESCE(attribution, ?),
           notice_sent_at = COALESCE(notice_sent_at, ?),
           note = CASE WHEN ? IS NULL THEN note WHEN note IS NULL THEN ? ELSE note || char(10) || char(10) || ? END,
           next_action = COALESCE(?, next_action), next_action_at = COALESCE(?, next_action_at),
           created_at = MIN(created_at, ?), last_activity_at = MAX(last_activity_at, ?), updated_at = ?
         WHERE id = ?`,
      ).run(
        kind,
        name, company,
        email, emailHash,
        phone, phoneHash,
        enquiryReference, prospectId,
        sourceLabel, sourceUtm, attribution,
        input.noticeSentAt ?? null,
        note, note, note,
        nextAction, nextActionAt,
        createdAt, createdAt, now,
        existing.id,
      );
      insertActivity(db, {
        leadId: existing.id,
        prospectId: existing.prospect_id ?? prospectId,
        kind: "merged",
        channel: CHANNEL_FOR_KIND[input.kind],
        summary: `Merged: new ${KIND_LABELS[input.kind].toLowerCase()} enquiry${enquiryReference ? ` ${enquiryReference}` : ""}`,
        payload: { kind: input.kind, enquiryReference, sourceLabel },
        actor: "system",
        createdAt,
      });
      const next = stageAfterInboundMerge(existing.stage as LeadStage, input.kind);
      if (next !== existing.stage) applyStage(db, existing.id, next, "system", createdAt);
      return { lead: readLead(db, existing.id)!, merged: true };
    }

    const reference = newReference("LD", db);
    // The browser hints are stored only where the schema already carries them,
    // so an older database keeps working and simply reads them back as null.
    const extraColumns = columnsPresent(db, "leads", OPTIONAL_LEAD_COLUMNS);
    const extraValues = extraColumns.map((c) => (c === "browser_country" ? browserCountry : browserTz));
    const info = db
      .prepare(
        `INSERT INTO leads (reference, kind, stage, name, company, email, email_hash, phone, phone_hash, locale, country,
           source_label, source_utm, attribution, enquiry_reference, prospect_id, legal_basis, data_source, notice_sent_at,
           next_action, next_action_at, note, last_activity_at, ip, created_at, updated_at${extraColumns.length ? `, ${extraColumns.join(", ")}` : ""})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${extraColumns.map(() => ", ?").join("")})`,
      )
      .run(
        reference, input.kind, input.stage ?? "new", name, company, email, emailHash, phone, phoneHash, locale, country,
        sourceLabel, sourceUtm, attribution, enquiryReference, prospectId, input.legalBasis ?? "request", input.dataSource ?? "form",
        input.noticeSentAt ?? null, nextAction, nextActionAt, note, createdAt, clean(input.ip, 64), createdAt, now,
        ...extraValues,
      );
    const id = Number(info.lastInsertRowid);
    insertActivity(db, {
      leadId: id,
      prospectId,
      kind: "lead_created",
      channel: CHANNEL_FOR_KIND[input.kind],
      summary: `${KIND_LABELS[input.kind]} lead created${sourceLabel ? ` · ${sourceLabel}` : ""}`,
      payload: { kind: input.kind, enquiryReference, sourceLabel },
      actor: "system",
      createdAt,
    });
    return { lead: readLead(db, id)!, merged: false };
  })();
}

// ---- reads ----------------------------------------------------------------------

export function getLead(id: number): LeadRecord | null {
  return readLead(enquiriesDb(), id);
}

export function getLeadByReference(reference: string): LeadRecord | null {
  const db = enquiriesDb();
  const row = db.prepare(`SELECT ${leadColumns(db)} FROM leads WHERE reference = ?`).get(reference) as LeadRow | undefined;
  return row ? rowToLead(row) : null;
}

/** Sort keys accepted by the list page → column (identifier allowlist, contract §0). */
export const LEAD_SORTS: Record<string, string> = {
  activity: "last_activity_at",
  created: "created_at",
  next: "next_action_at",
  stage: "stage",
  name: "name",
};

export interface LeadListQuery {
  stage?: LeadStage | "open" | "all";
  kind?: LeadKind;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function listLeads(query: LeadListQuery = {}): { rows: Lead[]; total: number } {
  const db = enquiriesDb();
  const where: string[] = [];
  const params: unknown[] = [];
  const stage = query.stage ?? "open";
  if (stage === "open") where.push(`stage NOT IN (${CLOSED_LIST})`);
  else if (isLeadStage(stage)) {
    where.push("stage = ?");
    params.push(stage);
  }
  if (query.kind && isLeadKind(query.kind)) {
    where.push("kind = ?");
    params.push(query.kind);
  }
  const q = clean(query.q, 100);
  if (q) {
    const term = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(reference LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR enquiry_reference LIKE ? ESCAPE '\\')");
    params.push(term, term, term, term, term, term);
  }
  const column = allowed(LEAD_SORTS, query.sort, "activity");
  const dir = query.dir === "asc" ? "ASC" : "DESC";
  // NULL next actions sink to the bottom whichever way the list is sorted.
  const order = column === "next_action_at" ? `next_action_at IS NULL, next_action_at ${dir}, id DESC` : `${column} ${dir}, id DESC`;
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const offset = Math.max(0, query.offset ?? 0);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM leads ${whereSql}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT ${leadColumns(db)} FROM leads ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as LeadRow[];
  return { rows: rows.map(rowToLead), total };
}

/** Open-lead counts per stage for the filter bar. */
export function leadStageCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of enquiriesDb().prepare("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage").all() as { stage: string; n: number }[]) out[r.stage] = r.n;
  return out;
}

/** Facts the lead page shows about a linked prospect (read-only; finder owns the table). */
export interface ProspectSummary {
  id: number;
  reference: string;
  name: string;
  country: string;
  website: string | null;
  latestAuditReference: string | null;
  latestScore: number | null;
  /** The public report's token, so the lead page can link straight to /r/<token>. */
  latestReportToken: string | null;
  optedOutAt: string | null;
}

export function getProspectSummary(prospectId: number): ProspectSummary | null {
  const row = enquiriesDb()
    .prepare(
      `SELECT p.id, p.reference, p.name, p.country, p.website, p.latest_score AS latestScore, p.opted_out_at AS optedOutAt,
              (SELECT a.reference FROM audits a WHERE a.id = p.latest_audit_id) AS latestAuditReference,
              (SELECT a.report_token FROM audits a WHERE a.id = p.latest_audit_id) AS latestReportToken
       FROM prospects p WHERE p.id = ?`,
    )
    .get(prospectId) as ProspectSummary | undefined;
  return row ?? null;
}

/**
 * The check-up behind a lead (read-only). It carries the `answers` column now:
 * the lead page used to query nine columns and skip the one where everything
 * the customer actually said lives.
 */
export interface EnquirySummary {
  reference: string;
  grade: string;
  proposed: string;
  urgent: boolean;
  subjectSummary: string | null;
  replyDraft: string | null;
  noteForRadu: string | null;
  mailStatus: string | null;
  createdAt: string;
  /** Parsed answers, or null when the column is empty or could not be read. */
  answers: Record<string, unknown> | null;
  /** True when the stored JSON would not parse — the page says so instead of failing. */
  answersBroken: boolean;
  scores: Record<string, number> | null;
  flagged: boolean;
  ip: string | null;
  source: string | null;
  callQuestions: string[] | null;
  unknowns: string | null;
  noFit: string | null;
  browserCountry: string | null;
  browserTz: string | null;
}

type EnquirySummaryRow = {
  reference: string;
  grade: string;
  proposed: string;
  urgent: number;
  subjectSummary: string | null;
  replyDraft: string | null;
  noteForRadu: string | null;
  mailStatus: string | null;
  createdAt: string;
  answers: string | null;
  scores: string | null;
  flagged: number | null;
  ip: string | null;
  source: string | null;
  call_questions?: string | null;
  unknowns?: string | null;
  no_fit?: string | null;
  browser_country?: string | null;
  browser_tz?: string | null;
};

function parseAnswersColumn(raw: string | null): { answers: Record<string, unknown> | null; broken: boolean } {
  if (!raw || !raw.trim()) return { answers: null, broken: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { answers: null, broken: true };
    return { answers: parsed as Record<string, unknown>, broken: false };
  } catch {
    return { answers: null, broken: true };
  }
}

export function getEnquirySummary(reference: string): EnquirySummary | null {
  const db = enquiriesDb();
  const extra = columnsPresent(db, "enquiries", OPTIONAL_ENQUIRY_COLUMNS);
  const row = db
    .prepare(
      `SELECT reference, grade, proposed, urgent, subject_summary AS subjectSummary, reply_draft AS replyDraft,
              note_for_radu AS noteForRadu, mail_status AS mailStatus, created_at AS createdAt,
              answers, scores, flagged, ip, source${extra.length ? `, ${extra.join(", ")}` : ""}
       FROM enquiries WHERE reference = ?`,
    )
    .get(reference) as EnquirySummaryRow | undefined;
  if (!row) return null;
  const { answers, broken } = parseAnswersColumn(row.answers);
  const questions = parseJson<unknown>(row.call_questions ?? null, null);
  return {
    reference: row.reference,
    grade: row.grade,
    proposed: row.proposed,
    urgent: row.urgent === 1,
    subjectSummary: row.subjectSummary,
    replyDraft: row.replyDraft,
    noteForRadu: row.noteForRadu,
    mailStatus: row.mailStatus,
    createdAt: row.createdAt,
    answers,
    answersBroken: broken,
    scores: parseJson<Record<string, number> | null>(row.scores, null),
    flagged: row.flagged === 1,
    ip: row.ip,
    source: row.source,
    callQuestions: Array.isArray(questions) ? questions.map((q) => String(q)).filter((q) => q.trim() !== "") : null,
    unknowns: row.unknowns ?? null,
    noFit: row.no_fit ?? null,
    browserCountry: row.browser_country ?? null,
    browserTz: row.browser_tz ?? null,
  };
}

/**
 * Every lead on one campaign, for the lead page's roll-up line and ad count.
 *
 * The campaign name is matched in SQL first — the JSON is a stored string, so
 * a LIKE on the name cuts the rows this has to parse down to the campaign
 * itself — and the exact test still happens in JS, because a name can appear
 * in another key. The cap then counts rows of THIS campaign rather than of
 * every attributed lead in the table, which is what made the "(3 of your 5
 * leads)" count go quietly wrong past the five hundredth attributed lead.
 */
export function campaignLeadRows(campaign: string): { reference: string; phone: string | null; browserCountry: string | null; attribution: Attribution | null }[] {
  const name = clean(campaign, 100);
  if (!name) return [];
  const db = enquiriesDb();
  const hasHint = columnsPresent(db, "leads", ["browser_country"]).length > 0;
  const like = `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `SELECT reference, phone, attribution${hasHint ? ", browser_country" : ""} FROM leads
       WHERE attribution IS NOT NULL AND attribution LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 2000`,
    )
    .all(like) as { reference: string; phone: string | null; attribution: string | null; browser_country?: string | null }[];
  return rows
    .map((r) => ({
      reference: r.reference,
      phone: r.phone,
      browserCountry: r.browser_country ?? null,
      attribution: parseJson<Attribution | null>(r.attribution, null),
    }))
    .filter((r) => (r.attribution?.utm_campaign ?? "") === name);
}

// ---- updates --------------------------------------------------------------------

function applyStage(db: Db, id: number, to: LeadStage, actor: Activity["actor"], at = sqlNow()): boolean {
  const current = db.prepare("SELECT stage, replied_at FROM leads WHERE id = ?").get(id) as { stage: string; replied_at: string | null } | undefined;
  if (!current || !isLeadStage(current.stage)) return false;
  const patch = stagePatch({ stage: current.stage, repliedAt: current.replied_at }, to, at);
  if (!patch) return false;
  db.prepare("UPDATE leads SET stage = ?, replied_at = ?, closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ?").run(
    patch.stage,
    patch.repliedAt,
    patch.closedAt,
    patch.closeReason,
    at,
    id,
  );
  insertActivity(db, {
    leadId: id,
    kind: "stage_change",
    channel: "system",
    summary: `Stage: ${STAGE_LABELS[current.stage]} → ${STAGE_LABELS[to]}`,
    payload: { from: current.stage, to },
    actor,
    createdAt: at,
  });
  return true;
}

export interface LeadPatch {
  stage?: LeadStage;
  nextAction?: string | null;
  nextActionAt?: string | null;
  note?: string | null;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Patches the editable columns; a stage change also writes a stage_change activity. */
export function updateLead(id: number, patch: LeadPatch, actor: Activity["actor"] = "admin"): Lead | null {
  const db = enquiriesDb();
  return db.transaction(() => {
    const before = readLead(db, id);
    if (!before) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if ("nextAction" in patch) set("next_action", clean(patch.nextAction, 200));
    if ("nextActionAt" in patch) set("next_action_at", clean(patch.nextActionAt, 10));
    if ("note" in patch) set("note", cleanText(patch.note, 4000));
    if ("name" in patch) set("name", clean(patch.name, 200));
    if ("company" in patch) set("company", clean(patch.company, 200));
    if ("email" in patch) {
      const email = cleanEmail(patch.email);
      set("email", email);
      set("email_hash", email ? hashEmail(email) : null);
    }
    if ("phone" in patch) {
      const phone = clean(patch.phone, 50);
      set("phone", phone);
      set("phone_hash", phone ? hashPhone(phone, before.country) : null);
    }
    if (sets.length) {
      set("updated_at", sqlNow());
      params.push(id);
      db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
    if (patch.stage) applyStage(db, id, patch.stage, actor);
    return readLead(db, id);
  })();
}

/** "Mark replied": an email_in activity and, from new/contacted, the replied stage. */
export function markReplied(id: number, note?: string | null): Lead | null {
  const db = enquiriesDb();
  return db.transaction(() => {
    const lead = readLead(db, id);
    if (!lead) return null;
    insertActivity(db, {
      leadId: id,
      prospectId: lead.prospectId,
      kind: "email_in",
      channel: "email",
      summary: clean(note, 300) ?? "Reply received",
      actor: "prospect",
    });
    applyStage(db, id, stageAfterReply(lead.stage), "admin");
    return readLead(db, id);
  })();
}

/**
 * A bounce reported by the admin: the send becomes `bounced`, the prospect's
 * address is downgraded to `unknown` so the ready view drops it, one bounce
 * activity. Returns null when the send reference is unknown.
 */
export function recordBounce(leadId: number, sendReference: string): Activity | null {
  const db = enquiriesDb();
  return db.transaction(() => {
    const send = db.prepare("SELECT id, prospect_id, lead_id FROM sends WHERE reference = ?").get(sendReference) as
      | { id: number; prospect_id: number; lead_id: number | null }
      | undefined;
    if (!send) return null;
    db.prepare("UPDATE sends SET status = 'bounced', error = COALESCE(error, 'bounced') WHERE id = ?").run(send.id);
    db.prepare("UPDATE prospects SET website_email_kind = 'unknown', updated_at = ? WHERE id = ?").run(sqlNow(), send.prospect_id);
    return insertActivity(db, {
      leadId,
      prospectId: send.prospect_id,
      kind: "bounce",
      channel: "email",
      summary: `Bounce on ${sendReference}`,
      payload: { sendReference },
      actor: "admin",
    });
  })();
}

/**
 * Folds `sourceId` into `targetId`: activities, enquiries, prospects, sends
 * and opt-outs are re-pointed, empty target fields filled from the source,
 * earliest created_at kept, then the source row is deleted.
 */
export function mergeLeads(sourceId: number, targetId: number): Lead | null {
  if (sourceId === targetId) return getLead(targetId);
  const db = enquiriesDb();
  return db.transaction(() => {
    const source = db.prepare(`SELECT ${leadColumns(db)} FROM leads WHERE id = ?`).get(sourceId) as LeadRow | undefined;
    const target = db.prepare(`SELECT ${leadColumns(db)} FROM leads WHERE id = ?`).get(targetId) as LeadRow | undefined;
    if (!source || !target) return null;
    const now = sqlNow();
    db.prepare(
      `UPDATE leads SET
         kind = ?, name = COALESCE(name, ?), company = COALESCE(company, ?),
         email = COALESCE(email, ?), email_hash = COALESCE(email_hash, ?), phone = COALESCE(phone, ?), phone_hash = COALESCE(phone_hash, ?),
         enquiry_reference = COALESCE(enquiry_reference, ?), prospect_id = COALESCE(prospect_id, ?),
         source_label = COALESCE(source_label, ?), source_utm = COALESCE(source_utm, ?), attribution = COALESCE(attribution, ?),
         notice_sent_at = COALESCE(notice_sent_at, ?), replied_at = COALESCE(replied_at, ?),
         next_action = COALESCE(next_action, ?), next_action_at = COALESCE(next_action_at, ?),
         note = CASE WHEN ? IS NULL THEN note WHEN note IS NULL THEN ? ELSE note || char(10) || char(10) || ? END,
         created_at = MIN(created_at, ?), last_activity_at = MAX(last_activity_at, ?), updated_at = ?
       WHERE id = ?`,
    ).run(
      mergedKind(target.kind as LeadKind, source.kind as LeadKind),
      source.name, source.company,
      source.email, source.email_hash, source.phone, source.phone_hash,
      source.enquiry_reference, source.prospect_id,
      source.source_label, source.source_utm, source.attribution,
      source.notice_sent_at, source.replied_at,
      source.next_action, source.next_action_at,
      source.note, source.note, source.note,
      source.created_at, source.last_activity_at, now,
      targetId,
    );
    db.prepare("UPDATE activities SET lead_id = ? WHERE lead_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE enquiries SET lead_id = ? WHERE lead_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE prospects SET lead_id = ? WHERE lead_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE sends SET lead_id = ? WHERE lead_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE optouts SET lead_id = ? WHERE lead_id = ?").run(targetId, sourceId);
    db.prepare("DELETE FROM leads WHERE id = ?").run(sourceId);
    insertActivity(db, {
      leadId: targetId,
      prospectId: target.prospect_id ?? source.prospect_id,
      kind: "merged",
      channel: "system",
      summary: `Merged ${source.reference} into this lead`,
      payload: { from: source.reference, kind: source.kind },
      actor: "admin",
    });
    return readLead(db, targetId);
  })();
}

// ---- links to enquiries, audits, prospects ------------------------------------------

/** Points the enquiry row at its lead (the diagnostic hook and the backfill). */
export function linkEnquiry(reference: string, leadId: number): void {
  enquiriesDb().prepare("UPDATE enquiries SET lead_id = ? WHERE reference = ?").run(leadId, reference);
}

/**
 * utm_campaign=AU-XXXXX on an inbound form means the person came from an
 * outreach report: link the lead to that audit's prospect and label the source.
 * Returns false when no audit carries the reference.
 */
export function attachByCampaign(leadId: number, campaign: string): boolean {
  const db = enquiriesDb();
  return db.transaction(() => {
    const audit = db.prepare("SELECT id, reference, prospect_id FROM audits WHERE reference = ?").get(campaign) as
      | { id: number; reference: string; prospect_id: number }
      | undefined;
    if (!audit) return false;
    db.prepare("UPDATE leads SET prospect_id = ?, source_label = ?, updated_at = ? WHERE id = ?").run(
      audit.prospect_id,
      `Outreach report ${audit.reference}`,
      sqlNow(),
      leadId,
    );
    db.prepare("UPDATE prospects SET lead_id = ? WHERE id = ? AND lead_id IS NULL").run(leadId, audit.prospect_id);
    insertActivity(db, {
      leadId,
      prospectId: audit.prospect_id,
      kind: "note",
      channel: "web",
      summary: `Came in from outreach report ${audit.reference}`,
      payload: { audit: audit.reference },
      actor: "system",
    });
    return true;
  })();
}

type ProspectRow = {
  id: number;
  reference: string;
  lead_id: number | null;
  name: string;
  country: string;
  locale: string;
  source: string;
  website_email: string | null;
  contact_email_override: string | null;
  website_phone: string | null;
  source_phone: string | null;
  contact_phone_override: string | null;
  notice_sent_at: string | null;
};

const DATA_SOURCE_FOR_PROSPECT: Record<string, Lead["dataSource"]> = {
  osm: "osm",
  fr_register: "register",
  companies_house: "companies_house",
  google: "manual",
  manual: "website",
};

/**
 * The lead behind an outreach send or call (contract §5): returns the lead in
 * prospects.lead_id, or creates one (merging into an open lead with the same
 * email, if any) and sets prospects.lead_id when empty.
 */
export function ensureLeadForProspect(
  prospectId: number,
  init: { kind: "outreach"; stage: "contacted"; nextAction: string; nextActionAt: string },
): Lead {
  const db = enquiriesDb();
  return db.transaction(() => {
    const p = db
      .prepare(
        `SELECT id, reference, lead_id, name, country, locale, source, website_email, contact_email_override,
                website_phone, source_phone, contact_phone_override, notice_sent_at
         FROM prospects WHERE id = ?`,
      )
      .get(prospectId) as ProspectRow | undefined;
    if (!p) throw new Error(`prospect ${prospectId} not found`);
    if (p.lead_id !== null) {
      const existing = readLead(db, p.lead_id);
      if (existing) return existing;
    }
    const { lead } = insertLead({
      kind: init.kind,
      stage: init.stage,
      company: p.name,
      email: p.contact_email_override ?? p.website_email,
      phone: p.contact_phone_override ?? p.website_phone ?? p.source_phone,
      locale: p.locale,
      country: p.country,
      sourceLabel: `Outreach · ${p.reference}`,
      prospectId: p.id,
      legalBasis: "legitimate_interest",
      dataSource: DATA_SOURCE_FOR_PROSPECT[p.source] ?? "manual",
      noticeSentAt: p.notice_sent_at,
      nextAction: init.nextAction,
      nextActionAt: init.nextActionAt,
    });
    db.prepare("UPDATE prospects SET lead_id = ? WHERE id = ? AND lead_id IS NULL").run(lead.id, p.id);
    db.prepare("UPDATE leads SET prospect_id = COALESCE(prospect_id, ?) WHERE id = ?").run(p.id, lead.id);
    return readLead(db, lead.id)!;
  })();
}

// ---- backfill --------------------------------------------------------------------

type EnquiryRow = {
  id: number;
  reference: string;
  locale: string;
  first_name: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  source_utm: string | null;
  attribution: string | null;
  ip: string | null;
  created_at: string;
};

export function pendingBackfill(): number {
  return (enquiriesDb().prepare("SELECT COUNT(*) AS n FROM enquiries WHERE lead_id IS NULL").get() as { n: number }).n;
}

/**
 * Creates a diagnostic lead for every enquiry without one, oldest first, and
 * stamps enquiries.lead_id (merged ones too), so a second run finds nothing.
 */
export function backfillEnquiries(): { created: number; merged: number; pending: number } {
  const db = enquiriesDb();
  const rows = db
    .prepare(
      "SELECT id, reference, locale, first_name, email, company, phone, source_utm, attribution, ip, created_at FROM enquiries WHERE lead_id IS NULL ORDER BY created_at, id",
    )
    .all() as EnquiryRow[];
  let created = 0;
  let merged = 0;
  for (const e of rows) {
    const attr = parseJson<Attribution>(e.attribution, {});
    const result = insertLead({
      kind: "diagnostic",
      name: e.first_name,
      email: e.email,
      company: e.company,
      phone: e.phone,
      locale: e.locale,
      sourceLabel: attributionLabel(attr),
      sourceUtm: e.source_utm,
      attribution: attr,
      enquiryReference: e.reference,
      legalBasis: "request",
      dataSource: "form",
      noticeSentAt: e.created_at,
      ip: e.ip,
      createdAt: e.created_at,
    });
    db.prepare("UPDATE enquiries SET lead_id = ? WHERE id = ?").run(result.lead.id, e.id);
    if (result.merged) merged++;
    else created++;
    if (attr.utm_campaign && AUDIT_CAMPAIGN_RE.test(attr.utm_campaign)) attachByCampaign(result.lead.id, attr.utm_campaign);
  }
  return { created, merged, pending: pendingBackfill() };
}
