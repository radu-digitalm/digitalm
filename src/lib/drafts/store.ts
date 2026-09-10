// Drafts table (report writes it, outreach reads it at send time): load the
// latest draft of a prospect, build the DraftInput from the prospect and its
// latest finished audit (raw SQL, no finder/inbox imports — merge order §14),
// generate + insert, and the review-gated save. Values are always bound with
// ?; nothing here runs at module load.
import { countApiUsage } from "@/lib/crm/apiUsage";
import { sqlNow } from "@/lib/crm/db";
import type { Draft } from "@/lib/crm/types";
import { enquiriesDb } from "@/lib/enquiries";
import { tradeWords } from "@/lib/report/findings";
import { reportUrl, rowToAudit } from "@/lib/report/view";
import { generateDraft } from "./generate";
import { DEFAULT_SIGNATURE, DRAFT_CAPS, safeDisplayName, type DraftFields, type DraftInput, type PhoneSource } from "./templates";

/** Error with a stable code and HTTP status for the routes. */
export class DraftError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "DraftError";
    this.code = code;
    this.status = status;
  }
}

// ---- rows ------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

export function rowToDraft(r: Row): Draft {
  return {
    id: Number(r.id),
    prospectId: Number(r.prospect_id),
    auditId: Number(r.audit_id),
    locale: r.locale === "fr" ? "fr" : "en",
    subject: String(r.subject ?? ""),
    body: String(r.body ?? ""),
    callScript: String(r.call_script ?? ""),
    noteForOwner: String(r.note_for_owner ?? ""),
    model: str(r.model),
    fallback: Number(r.fallback ?? 0) === 1,
    generatedAt: String(r.generated_at ?? ""),
    editedAt: str(r.edited_at),
    reviewedAt: str(r.reviewed_at),
  };
}

export function getDraft(id: number): Draft | null {
  const row = enquiriesDb().prepare("SELECT * FROM drafts WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToDraft(row) : null;
}

/** The newest draft of a prospect (any audit) — the one the panel shows and outreach sends. */
export function latestDraft(prospectId: number): Draft | null {
  const row = enquiriesDb().prepare("SELECT * FROM drafts WHERE prospect_id = ? ORDER BY id DESC LIMIT 1").get(prospectId) as Row | undefined;
  return row ? rowToDraft(row) : null;
}

// ---- context ---------------------------------------------------------------------------

interface ProspectBits {
  id: number;
  reference: string;
  locale: "fr" | "en";
  displayName: string;
  town: string | null;
  trade: string | null;
  country: string;
  soleTrader: boolean | null;
  phoneSource: PhoneSource | null;
}

function loadProspect(prospectId: number): ProspectBits | null {
  const r = enquiriesDb()
    .prepare(
      `SELECT id, reference, name, legal_name, enseigne, sole_trader, city, trade_key, country, locale, source,
              website_phone, source_phone, contact_phone_override, deleted_at
         FROM prospects WHERE id = ?`,
    )
    .get(prospectId) as Row | undefined;
  if (!r || r.deleted_at) return null;
  const locale = r.locale === "fr" ? "fr" : "en";
  const soleTrader = r.sole_trader === null || r.sole_trader === undefined ? null : Number(r.sole_trader) === 1;
  // Where the number the call script mentions came from, in priority order.
  let phoneSource: PhoneSource | null = null;
  if (r.contact_phone_override) phoneSource = "manual";
  else if (r.website_phone) phoneSource = "website";
  else if (r.source_phone) {
    const s = str(r.source);
    phoneSource = s === "osm" || s === "fr_register" || s === "companies_house" || s === "google" || s === "manual" ? s : null;
  }
  return {
    id: Number(r.id),
    reference: String(r.reference),
    locale,
    displayName: safeDisplayName({ enseigne: str(r.enseigne), legalName: str(r.legal_name), name: str(r.name), soleTrader }, locale),
    town: str(r.city),
    trade: tradeWords(str(r.trade_key), locale),
    country: String(r.country ?? "FR"),
    soleTrader,
    phoneSource,
  };
}

function latestDoneAudit(prospectId: number) {
  const row = enquiriesDb()
    .prepare("SELECT * FROM audits WHERE prospect_id = ? AND status = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1")
    .get(prospectId) as Row | undefined;
  return row ? rowToAudit(row) : null;
}

export interface DraftContext {
  prospect: ProspectBits;
  audit: ReturnType<typeof rowToAudit>;
  input: DraftInput;
}

/** Everything generateDraft() needs for a prospect; throws DraftError prospect_not_found / audit_missing. */
export function draftContext(prospectId: number): DraftContext {
  const prospect = loadProspect(prospectId);
  if (!prospect) throw new DraftError("prospect_not_found", 404);
  const audit = latestDoneAudit(prospectId);
  if (!audit) throw new DraftError("audit_missing", 409);
  const input: DraftInput = {
    locale: prospect.locale,
    prospect: {
      displayName: prospect.displayName,
      town: prospect.town,
      trade: prospect.trade,
      country: prospect.country,
      soleTrader: prospect.soleTrader,
      phoneSource: prospect.phoneSource,
    },
    checks: audit.checks,
    flags: audit.flags,
    top: audit.top,
    score: audit.score,
    grade: audit.grade,
    fits: audit.fits,
    reportUrl: reportUrl(audit.reportToken),
    signature: process.env.OUTREACH_FROM_NAME || DEFAULT_SIGNATURE,
  };
  return { prospect, audit, input };
}

// ---- write ----------------------------------------------------------------------------------

/** Generate (model or template) and insert a new draft row; the previous rows stay as history. */
export async function createDraft(prospectId: number): Promise<Draft & { reason: string | null }> {
  const { prospect, audit, input } = draftContext(prospectId);
  const g = await generateDraft(input);
  if (g.attempts > 0) countApiUsage("openai_drafts", g.attempts);
  const res = enquiriesDb()
    .prepare(
      `INSERT INTO drafts (prospect_id, audit_id, locale, subject, body, call_script, note_for_owner, model, fallback)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(prospect.id, audit.id, input.locale, g.subject, g.body, g.callScript, g.noteForOwner, g.model, g.fallback ? 1 : 0);
  const draft = getDraft(Number(res.lastInsertRowid));
  if (!draft) throw new DraftError("insert_failed", 500);
  return { ...draft, reason: g.reason };
}

// Generous caps for a human's edits (the DRAFT_CAPS are for the model).
const EDIT_MAX = { subject: 200, body: 6000, callScript: 3000, noteForOwner: 2000 } as const;

/** Whitelist + sanitise the posted fields; unknown keys ignored, wrong types refused. */
export function readDraftEdits(body: unknown): Partial<DraftFields> {
  if (!body || typeof body !== "object") throw new DraftError("bad_request", 400);
  const src = body as Record<string, unknown>;
  const out: Partial<DraftFields> = {};
  for (const key of Object.keys(EDIT_MAX) as (keyof typeof EDIT_MAX)[]) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new DraftError(`bad_${key}`, 422);
    let s = v.replace(/\r\n?/g, "\n").replace(/[^\S\n]+$/gm, "").trim();
    if (key === "subject") s = s.replace(/[\r\n]+/g, " ");
    if (s.length > EDIT_MAX[key]) throw new DraftError(`too_long_${key}`, 422);
    if ((key === "subject" || key === "body") && !s) throw new DraftError(`empty_${key}`, 422);
    out[key] = s;
  }
  return out;
}

/**
 * Save edits and mark the draft as reviewed: edited_at when a field changed,
 * reviewed_at always (a Save without a change is still a review — outreach
 * refuses to send while reviewed_at is null).
 */
export function saveDraft(id: number, edits: Partial<DraftFields>): Draft {
  const current = getDraft(id);
  if (!current) throw new DraftError("not_found", 404);
  const next: DraftFields = {
    subject: edits.subject ?? current.subject,
    body: edits.body ?? current.body,
    callScript: edits.callScript ?? current.callScript,
    noteForOwner: edits.noteForOwner ?? current.noteForOwner,
  };
  const changed =
    next.subject !== current.subject || next.body !== current.body || next.callScript !== current.callScript || next.noteForOwner !== current.noteForOwner;
  const now = sqlNow();
  enquiriesDb()
    .prepare(
      `UPDATE drafts SET subject = ?, body = ?, call_script = ?, note_for_owner = ?, edited_at = COALESCE(?, edited_at), reviewed_at = ? WHERE id = ?`,
    )
    .run(next.subject, next.body, next.callScript, next.noteForOwner, changed ? now : null, now, id);
  return getDraft(id)!;
}

// ---- panel state -------------------------------------------------------------------------------

export interface DraftPanelState {
  prospect: { id: number; reference: string; displayName: string; locale: "fr" | "en" };
  audit: { id: number; reference: string; score: number | null; grade: "A" | "B" | "C" | null; finishedAt: string | null; reportUrl: string } | null;
  draft: Draft | null;
  /** The newest draft belongs to an older audit than the latest finished one. */
  draftStale: boolean;
  llm: boolean;
  model: string;
  caps: typeof DRAFT_CAPS;
}

/** What DraftPanel self-loads from GET /api/admin/prospects/[id]/draft. */
export function draftPanelState(prospectId: number): DraftPanelState {
  const prospect = loadProspect(prospectId);
  if (!prospect) throw new DraftError("prospect_not_found", 404);
  const audit = latestDoneAudit(prospectId);
  const draft = latestDraft(prospectId);
  return {
    prospect: { id: prospect.id, reference: prospect.reference, displayName: prospect.displayName, locale: prospect.locale },
    audit: audit
      ? { id: audit.id, reference: audit.reference, score: audit.score, grade: audit.grade, finishedAt: audit.finishedAt, reportUrl: reportUrl(audit.reportToken) }
      : null,
    draft,
    draftStale: !!(draft && audit && draft.auditId !== audit.id),
    llm: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL_DRAFTS || "gpt-4.1-mini",
    caps: DRAFT_CAPS,
  };
}
