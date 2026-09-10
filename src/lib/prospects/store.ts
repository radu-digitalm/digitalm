// Prospect store (contract §6 "Search / dedupe / save" and "Views"): saving
// ticked search rows and Add-by-URL entries with the 30-day notice deadline,
// the ready / call / all / not_fit views on READY_WHERE and CALL_WHERE from
// crm/db.ts, the admin patch (fit, locale, website, overrides, forbids
// override, not-this-business, recollect), wipePersonal and "Audit next 20".
// Every stored value carries its source (source, website_source, geo_source,
// provenance from dedupe). Sort/filter identifiers come from fixed allowlists;
// values are always bound with ?.
import { allowed } from "@/lib/crm/allowlist";
import { cacheGet } from "@/lib/crm/apiCache";
import { coerceHttpUrl, domainOf, isWebmailDomain, localeForCountry, normaliseEmail, normaliseName, validEmail } from "@/lib/crm/classify";
import { CALL_WHERE, READY_WHERE, parseJson } from "@/lib/crm/db";
import { sqlNow } from "@/lib/crm/time";
import { enqueue } from "@/lib/crm/jobs";
import { newReference } from "@/lib/crm/refs";
import type { ActivityKind, EmailKind, Prospect } from "@/lib/crm/types";
import { enquiriesDb } from "@/lib/enquiries";
import { tradeKeyFor } from "@/lib/discover/categories";
import { sameByNameAndPlace, type MergedBusiness } from "@/lib/discover/dedupe";
import type { SearchResult } from "@/lib/discover/index";

/** Error with a stable code and HTTP status for the routes. */
export class ProspectError extends Error {
  code: string;
  status: number;
  detail: unknown;
  constructor(code: string, status = 422, detail?: unknown) {
    super(code);
    this.name = "ProspectError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Prospect plus the finder-only `brand` column (chain badge). */
export type ProspectRecord = Prospect & { brand: string | null };

export type ProspectListRow = ProspectRecord & {
  leadStage: string | null;
  leadReference: string | null;
  auditFinishedAt: string | null;
  callAttempts30d: number;
};

export type ProspectView = "ready" | "call" | "all" | "not_fit";
export const VIEWS: readonly ProspectView[] = ["ready", "call", "all", "not_fit"];

const CC_RE = /^[A-Z]{2}$/;
const NOTICE_DAYS = 30;

// ---- row mapping ----------------------------------------------------------------

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const boolOrNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : Number(v) === 1);

export function rowToProspect(r: Row): ProspectRecord {
  return {
    id: Number(r.id),
    reference: String(r.reference),
    leadId: num(r.lead_id),
    name: String(r.name ?? ""),
    legalName: str(r.legal_name),
    enseigne: str(r.enseigne),
    nameKey: String(r.name_key ?? ""),
    tradeKey: str(r.trade_key),
    country: String(r.country ?? "FR"),
    addressLine: str(r.address_line),
    postcode: str(r.postcode),
    city: str(r.city),
    region: str(r.region),
    lat: num(r.lat),
    lng: num(r.lng),
    geoSource: (str(r.geo_source) as Prospect["geoSource"]) ?? null,
    source: (str(r.source) as Prospect["source"]) ?? "manual",
    sourceId: str(r.source_id),
    sourceUrl: str(r.source_url),
    registerId: str(r.register_id),
    registerStatus: (str(r.register_status) as Prospect["registerStatus"]) ?? "unknown",
    registerCheckedAt: str(r.register_checked_at),
    diffusion: (str(r.diffusion) as Prospect["diffusion"]) ?? "na",
    legalForm: str(r.legal_form),
    soleTrader: boolOrNull(r.sole_trader),
    website: str(r.website),
    websiteSource: str(r.website_source),
    domainKey: str(r.domain_key),
    websiteEmail: str(r.website_email),
    websiteEmailKind: (str(r.website_email_kind) as EmailKind | null) ?? null,
    websiteEmailPage: str(r.website_email_page),
    websitePhone: str(r.website_phone),
    websiteSocials: parseJson<Record<string, string> | null>(str(r.website_socials), null),
    websiteCms: str(r.website_cms),
    sourcePhone: str(r.source_phone),
    sourceEmail: str(r.source_email),
    forbidsExtraction: Number(r.forbids_extraction ?? 0) === 1,
    forbidsOverrideReason: str(r.forbids_override_reason),
    googlePlaceId: str(r.google_place_id),
    googleListing: (str(r.google_listing) as Prospect["googleListing"]) ?? "unverified",
    googleConfirmedAt: str(r.google_confirmed_at),
    locale: r.locale === "fr" ? "fr" : "en",
    localeOverridden: Number(r.locale_overridden ?? 0) === 1,
    latestAuditId: num(r.latest_audit_id),
    latestScore: num(r.latest_score),
    latestGrade: (str(r.latest_grade) as Prospect["latestGrade"]) ?? null,
    fit: (str(r.fit) as Prospect["fit"]) ?? "unknown",
    notFitReason: str(r.not_fit_reason),
    contactEmailOverride: str(r.contact_email_override),
    contactPhoneOverride: str(r.contact_phone_override),
    noticeSentAt: str(r.notice_sent_at),
    noticeDeadlineAt: str(r.notice_deadline_at),
    personalWipedAt: str(r.personal_wiped_at),
    lastEmailedAt: str(r.last_emailed_at),
    lastCalledAt: str(r.last_called_at),
    optedOutAt: str(r.opted_out_at),
    tpsCheckedAt: str(r.tps_checked_at),
    searchId: num(r.search_id),
    savedAt: String(r.saved_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    deletedAt: str(r.deleted_at),
    brand: str(r.brand),
  };
}

export function getProspect(id: number): ProspectRecord | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = enquiriesDb().prepare("SELECT * FROM prospects WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToProspect(row) : null;
}

export function getProspectByReference(reference: string): ProspectRecord | null {
  const row = enquiriesDb().prepare("SELECT * FROM prospects WHERE reference = ?").get(reference) as Row | undefined;
  return row ? rowToProspect(row) : null;
}

// ---- activities (finder writes note + recollect only) ---------------------------------

export function insertActivity(input: {
  prospectId: number;
  leadId?: number | null;
  kind: ActivityKind;
  channel?: "email" | "phone" | "web" | "telegram" | "system" | null;
  summary: string;
  payload?: Record<string, string | number | boolean | null> | null;
  actor?: "admin" | "system";
}): number {
  const r = enquiriesDb()
    .prepare("INSERT INTO activities (lead_id, prospect_id, kind, channel, summary, payload, actor) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(input.leadId ?? null, input.prospectId, input.kind, input.channel ?? "system", input.summary.slice(0, 500), input.payload ? JSON.stringify(input.payload) : null, input.actor ?? "admin");
  return Number(r.lastInsertRowid);
}

// ---- already-saved marks ----------------------------------------------------------------

/**
 * Set `alreadySaved` on every search row that matches a live prospect by
 * (source, source_id), by domain_key, or by name + place. Mutates in place.
 */
export function markAlreadySaved(rows: MergedBusiness[]): void {
  if (rows.length === 0) return;
  const db = enquiriesDb();
  const byId = db.prepare("SELECT id, reference FROM prospects WHERE deleted_at IS NULL AND source = ? AND source_id = ? LIMIT 1");
  const byDomain = db.prepare("SELECT id, reference FROM prospects WHERE deleted_at IS NULL AND domain_key = ? LIMIT 1");
  const byName = db.prepare("SELECT id, reference, name, lat, lng, geo_source, postcode FROM prospects WHERE deleted_at IS NULL AND name_key = ? AND country = ? LIMIT 50");
  for (const row of rows) {
    delete row.alreadySaved;
    let hit = byId.get(row.source, row.sourceId) as { id: number; reference: string } | undefined;
    if (!hit && row.website) {
      const dk = domainOf(row.website);
      if (dk) hit = byDomain.get(dk) as { id: number; reference: string } | undefined;
    }
    if (!hit) {
      const nk = normaliseName(row.name);
      if (nk) {
        const candidates = byName.all(nk, row.countryCode) as { id: number; reference: string; name: string; lat: number | null; lng: number | null; geo_source: string | null; postcode: string | null }[];
        const match = candidates.find((c) =>
          sameByNameAndPlace(row, {
            name: c.name,
            lat: c.lat ?? undefined,
            lng: c.lng ?? undefined,
            geoSource: c.geo_source === "source" ? "source" : c.geo_source === "centre" ? "centre" : "none",
            postcode: c.postcode ?? undefined,
          }),
        );
        if (match) hit = { id: match.id, reference: match.reference };
      }
    }
    if (hit) row.alreadySaved = { prospectId: hit.id, reference: hit.reference };
  }
}

// ---- inserts ----------------------------------------------------------------------------

export type NewProspect = {
  name: string;
  legalName?: string | null;
  enseigne?: string | null;
  tradeKey?: string | null;
  country: string;
  addressLine?: string | null;
  postcode?: string | null;
  city?: string | null;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  geoSource?: "source" | "centre" | "manual" | null;
  source: Prospect["source"];
  sourceId?: string | null;
  sourceUrl?: string | null;
  registerId?: string | null;
  registerStatus?: Prospect["registerStatus"];
  diffusion?: Prospect["diffusion"];
  legalForm?: string | null;
  soleTrader?: boolean | null;
  website?: string | null;
  websiteSource?: string | null;
  sourcePhone?: string | null;
  sourceEmail?: string | null;
  brand?: string | null;
  searchId?: number | null;
};

/** Insert one prospect with saved_at = now and notice_deadline_at = saved_at + 30 days. */
export function insertProspect(p: NewProspect): { id: number; reference: string } {
  const db = enquiriesDb();
  const country = p.country.toUpperCase();
  if (!CC_RE.test(country)) throw new ProspectError("bad_country", 422);
  const name = p.name.trim().slice(0, 200);
  if (!name) throw new ProspectError("bad_name", 422);
  const website = p.website ? coerceHttpUrl(p.website) : null;
  const savedAt = sqlNow();
  const reference = newReference("PR", db);
  const r = db
    .prepare(
      `INSERT INTO prospects (
        reference, name, legal_name, enseigne, name_key, trade_key, country, address_line, postcode, city, region, lat, lng, geo_source,
        source, source_id, source_url, register_id, register_status, register_checked_at, diffusion, legal_form, sole_trader,
        website, website_source, domain_key, source_phone, source_email, brand, locale, notice_deadline_at, search_id, saved_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, '+${NOTICE_DAYS} days'), ?, ?, ?)`,
    )
    .run(
      reference,
      name,
      p.legalName?.trim().slice(0, 200) || null,
      p.enseigne?.trim().slice(0, 200) || null,
      normaliseName(name),
      p.tradeKey?.slice(0, 80) || null,
      country,
      p.addressLine?.slice(0, 200) || null,
      p.postcode?.slice(0, 12) || null,
      p.city?.slice(0, 80) || null,
      p.region?.slice(0, 80) || null,
      p.lat ?? null,
      p.lng ?? null,
      p.geoSource ?? null,
      p.source,
      p.sourceId || null,
      p.sourceUrl ? coerceHttpUrl(p.sourceUrl) : null,
      p.registerId || null,
      p.registerStatus ?? "unknown",
      p.registerId ? savedAt : null,
      p.diffusion ?? "na",
      p.legalForm || null,
      p.soleTrader === null || p.soleTrader === undefined ? null : p.soleTrader ? 1 : 0,
      website,
      website ? p.websiteSource ?? p.source : null,
      website ? domainOf(website) : null,
      p.sourcePhone?.slice(0, 40) || null,
      p.sourceEmail && validEmail(p.sourceEmail) ? p.sourceEmail.toLowerCase() : null,
      p.brand?.slice(0, 60) || null,
      localeForCountry(country),
      savedAt,
      p.searchId ?? null,
      savedAt,
      savedAt,
    );
  return { id: Number(r.lastInsertRowid), reference };
}

/** Queue an audit for one prospect (deduped on "audit:{id}"). */
export function enqueueAudit(prospectId: number): { id: number; deduped: boolean } {
  return enqueue("audit", { prospectId }, { dedupeKey: `audit:${prospectId}` });
}

function websiteSourceFor(row: MergedBusiness): string {
  const from = row.provenance?.website ?? row.source;
  return from === "fr_register" ? "register" : from;
}

export type SaveResult = {
  saved: number;
  auditsQueued: number;
  withoutWebsite: number;
  alreadySaved: number;
  unknown: number;
  references: string[];
};

/**
 * Save ticked rows of a cached search. Throws ProspectError
 * `search_expired` (410) when the cache is gone and `partial_diffusion` (422,
 * detail = the offending keys) when any pick is a non-diffusible register row.
 * Rows already saved (re-checked live) are skipped, not duplicated.
 */
export function saveFromSearch(searchId: number, picks: string[]): SaveResult {
  const result = cacheGet<SearchResult>(`search:${searchId}`);
  if (!result) throw new ProspectError("search_expired", 410);
  const wanted = new Set(picks.filter((k): k is string => typeof k === "string"));
  const rows = result.rows.filter((r) => wanted.has(r.key));
  const partialKeys = rows.filter((r) => r.diffusion === "partial").map((r) => r.key);
  if (partialKeys.length > 0) throw new ProspectError("partial_diffusion", 422, { picks: partialKeys });
  markAlreadySaved(rows);

  const db = enquiriesDb();
  const out: SaveResult = { saved: 0, auditsQueued: 0, withoutWebsite: 0, alreadySaved: 0, unknown: wanted.size - rows.length, references: [] };
  const tradeKey = tradeKeyFor({ key: result.category.key, label: result.category.label, osm: [], naf: [], sic: [], custom: result.category.custom });
  const insertAll = db.transaction((list: MergedBusiness[]) => {
    for (const row of list) {
      if (row.alreadySaved) {
        out.alreadySaved++;
        continue;
      }
      const hasRegister = !!row.registerId;
      const { id, reference } = insertProspect({
        name: row.name,
        legalName: row.legalName ?? null,
        enseigne: row.enseigne ?? null,
        tradeKey,
        country: row.countryCode,
        addressLine: row.addressLine ?? null,
        postcode: row.postcode ?? null,
        city: row.city ?? null,
        region: row.region ?? null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        geoSource: row.geoSource === "none" ? null : row.geoSource,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        registerId: row.registerId ?? null,
        registerStatus: hasRegister ? (row.active === false ? "ceased" : row.active === true ? "active" : "unknown") : "unknown",
        diffusion: hasRegister ? row.diffusion ?? "full" : "na",
        legalForm: row.legalForm ?? null,
        soleTrader: row.soleTrader ?? null,
        website: row.website ?? null,
        websiteSource: row.website ? websiteSourceFor(row) : null,
        sourcePhone: row.phone ?? null,
        sourceEmail: row.email ?? null,
        brand: row.brand ?? null,
        searchId,
      });
      out.saved++;
      out.references.push(reference);
      if (row.website) {
        enqueueAudit(id);
        out.auditsQueued++;
      } else {
        out.withoutWebsite++;
      }
    }
  });
  insertAll(rows);
  if (out.saved > 0) db.prepare("UPDATE searches SET saved_count = saved_count + ? WHERE id = ?").run(out.saved, searchId);
  return out;
}

/**
 * Add by URL (contract §6): `source manual`, domain_key, same 30-day deadline,
 * audit enqueued. A live prospect with the same domain is returned instead of
 * a duplicate (`existing: true`).
 */
export function addByUrl(input: { url: string; name?: string | null; country: string }): { id: number; reference: string; existing: boolean; auditQueued: boolean } {
  const website = coerceHttpUrl(input.url);
  if (!website) throw new ProspectError("bad_url", 422);
  const country = (input.country ?? "").trim().toUpperCase();
  if (!CC_RE.test(country)) throw new ProspectError("bad_country", 422);
  const domainKey = domainOf(website);
  if (!domainKey) throw new ProspectError("bad_url", 422);
  const db = enquiriesDb();
  const existing = db.prepare("SELECT id, reference FROM prospects WHERE deleted_at IS NULL AND domain_key = ? LIMIT 1").get(domainKey) as { id: number; reference: string } | undefined;
  if (existing) return { ...existing, existing: true, auditQueued: false };
  const name = (input.name ?? "").trim() || domainKey;
  const { id, reference } = insertProspect({ name, country, source: "manual", website, websiteSource: "manual", geoSource: null });
  enqueueAudit(id);
  return { id, reference, existing: false, auditQueued: true };
}

// ---- views -----------------------------------------------------------------------------

const SORTS: Record<string, string> = {
  score: "prospects.latest_score",
  saved: "prospects.saved_at",
  name: "prospects.name_key",
  deadline: "prospects.notice_deadline_at",
  city: "prospects.city",
  updated: "prospects.updated_at",
};

const SELECT = `SELECT prospects.*, ld.stage AS lead_stage, ld.reference AS lead_reference,
  (SELECT a.finished_at FROM audits a WHERE a.id = prospects.latest_audit_id) AS audit_finished_at,
  (SELECT COUNT(*) FROM activities ac WHERE ac.prospect_id = prospects.id AND ac.kind = 'call' AND ac.created_at > datetime('now', '-30 days')) AS call_attempts_30d
  FROM prospects LEFT JOIN leads ld ON ld.id = prospects.lead_id`;

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export type ListOptions = { view?: string; q?: string; sort?: string; dir?: string; limit?: number; offset?: number };

export function listProspects(opts: ListOptions = {}): { view: ProspectView; rows: ProspectListRow[]; limit: number; offset: number } {
  const view: ProspectView = (VIEWS as readonly string[]).includes(opts.view ?? "") ? (opts.view as ProspectView) : "ready";
  const q = (opts.q ?? "").trim().slice(0, 80);
  const params: unknown[] = [];
  let where: string;
  let order: string;
  let limit = Math.max(1, Math.min(500, opts.limit ?? 200));
  let offset = Math.max(0, opts.offset ?? 0);
  if (view === "ready") {
    where = READY_WHERE;
    order = "prospects.latest_score ASC, prospects.id ASC";
    limit = Math.min(limit, 20);
    offset = 0;
  } else if (view === "call") {
    where = CALL_WHERE;
    order = "prospects.latest_score IS NULL, prospects.latest_score ASC, prospects.saved_at ASC";
    limit = Math.min(limit, 50);
    offset = 0;
  } else {
    where = view === "not_fit" ? "prospects.deleted_at IS NULL AND prospects.fit = 'not_fit'" : "prospects.deleted_at IS NULL";
    const col = allowed(SORTS, opts.sort, "saved");
    const dir = opts.dir === "asc" ? "ASC" : "DESC";
    order = `${col} IS NULL, ${col} ${dir}, prospects.id DESC`;
  }
  if (q) {
    where = `(${where}) AND (prospects.name LIKE ? ESCAPE '\\' OR prospects.city LIKE ? ESCAPE '\\' OR prospects.domain_key LIKE ? ESCAPE '\\' OR prospects.reference = ?)`;
    const term = likeTerm(q);
    params.push(term, term, term, q.toUpperCase());
  }
  const rows = enquiriesDb()
    .prepare(`${SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Row[];
  return {
    view,
    limit,
    offset,
    rows: rows.map((r) => ({
      ...rowToProspect(r),
      leadStage: str(r.lead_stage),
      leadReference: str(r.lead_reference),
      auditFinishedAt: str(r.audit_finished_at),
      callAttempts30d: Number(r.call_attempts_30d ?? 0),
    })),
  };
}

/** Row counts per view for the tabs. */
export function countViews(): Record<ProspectView, number> {
  const db = enquiriesDb();
  const count = (where: string) => (db.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE ${where}`).get() as { n: number }).n;
  return {
    ready: count(READY_WHERE),
    call: count(CALL_WHERE),
    all: count("prospects.deleted_at IS NULL"),
    not_fit: count("prospects.deleted_at IS NULL AND prospects.fit = 'not_fit'"),
  };
}

// ---- patch ----------------------------------------------------------------------------

function cleanPhone(v: string): string | null {
  const p = v.replace(/[^\d+().\-\s/]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return p.replace(/\D/g, "").length >= 6 ? p : null;
}

export type ProspectPatch = {
  fit?: Prospect["fit"];
  not_fit_reason?: string | null;
  locale?: "fr" | "en";
  website?: string | null;
  contact_email_override?: string | null;
  contact_phone_override?: string | null;
  forbids_override_reason?: string | null;
  not_this_business?: boolean;
  recollect?: boolean;
};

/**
 * Apply an admin patch (contract §6 POST /api/admin/prospects/[id]). Throws
 * ProspectError not_found (404), bad_email / bad_phone / bad_website /
 * bad_fit / bad_locale (422). Returns the updated prospect.
 */
export function patchProspect(id: number, patch: ProspectPatch): ProspectRecord {
  const db = enquiriesDb();
  const current = getProspect(id);
  if (!current) throw new ProspectError("not_found", 404);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };
  const notes: string[] = [];

  if ("fit" in patch) {
    if (patch.fit !== "unknown" && patch.fit !== "fit" && patch.fit !== "not_fit") throw new ProspectError("bad_fit", 422);
    set("fit", patch.fit);
    set("not_fit_reason", patch.fit === "not_fit" ? (patch.not_fit_reason ?? "").trim().slice(0, 200) || null : null);
  } else if ("not_fit_reason" in patch && current.fit === "not_fit") {
    set("not_fit_reason", (patch.not_fit_reason ?? "").trim().slice(0, 200) || null);
  }
  if ("locale" in patch) {
    if (patch.locale !== "fr" && patch.locale !== "en") throw new ProspectError("bad_locale", 422);
    set("locale", patch.locale);
    set("locale_overridden", 1);
  }
  if ("website" in patch) {
    if (patch.website === null || patch.website === "") {
      set("website", null);
      set("website_source", null);
      set("domain_key", null);
    } else {
      const site = typeof patch.website === "string" ? coerceHttpUrl(patch.website) : null;
      if (!site) throw new ProspectError("bad_website", 422);
      set("website", site);
      set("website_source", "manual");
      set("domain_key", domainOf(site));
    }
  }
  if ("contact_email_override" in patch) {
    if (patch.contact_email_override === null || patch.contact_email_override === "") {
      set("contact_email_override", null);
    } else {
      const email = typeof patch.contact_email_override === "string" ? normaliseEmail(patch.contact_email_override) : null;
      if (!email) throw new ProspectError("bad_email", 422);
      // Private webmail addresses are never emailed (plan rule): refused here so
      // an override can never put one into "Ready to send"; the send path refuses again.
      if (isWebmailDomain(email.slice(email.lastIndexOf("@") + 1))) throw new ProspectError("webmail", 422);
      set("contact_email_override", email);
    }
  }
  if ("contact_phone_override" in patch) {
    if (patch.contact_phone_override === null || patch.contact_phone_override === "") {
      set("contact_phone_override", null);
    } else {
      const phone = typeof patch.contact_phone_override === "string" ? cleanPhone(patch.contact_phone_override) : null;
      if (!phone) throw new ProspectError("bad_phone", 422);
      set("contact_phone_override", phone);
    }
  }
  if ("forbids_override_reason" in patch) {
    const reason = typeof patch.forbids_override_reason === "string" ? patch.forbids_override_reason.trim().slice(0, 300) : "";
    if (reason && reason.length < 3) throw new ProspectError("bad_reason", 422);
    set("forbids_override_reason", reason || null);
    notes.push(reason ? `Forbids-extraction override: ${reason}` : "Forbids-extraction override removed");
  }
  if (patch.not_this_business === true) {
    set("deleted_at", sqlNow());
    set("fit", "not_fit");
    set("not_fit_reason", "not this business");
    notes.push("Marked as not this business (removed from every view)");
  }
  const recollect = patch.recollect === true;
  if (recollect) {
    set("personal_wiped_at", null);
    sets.push(`notice_deadline_at = datetime('now', '+${NOTICE_DAYS} days')`);
  }
  if (sets.length === 0) return current;

  sets.push("updated_at = datetime('now')");
  const apply = db.transaction(() => {
    db.prepare(`UPDATE prospects SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    for (const summary of notes) insertActivity({ prospectId: id, leadId: current.leadId, kind: "note", channel: "system", summary, actor: "admin" });
    if (recollect) {
      insertActivity({
        prospectId: id,
        leadId: current.leadId,
        kind: "recollect",
        channel: "system",
        summary: "Contact details may be collected again; new 30-day notice deadline",
        actor: "admin",
      });
    }
  });
  apply();
  return getProspect(id)!;
}

// ---- wipe -------------------------------------------------------------------------------

/**
 * Null every personal contact field (contract §6): website_email (kept when
 * `keepGenericEmail` and its kind is generic), website_email_page,
 * website_phone, source_email, source_phone, both overrides; set
 * personal_wiped_at. The audit job stores no contact fields while it is set.
 */
export function wipePersonal(p: { id: number }, opts: { keepGenericEmail: boolean }): void {
  const db = enquiriesDb();
  const emailClause = opts.keepGenericEmail
    ? "website_email = CASE WHEN website_email_kind = 'generic' THEN website_email ELSE NULL END, website_email_kind = CASE WHEN website_email_kind = 'generic' THEN website_email_kind ELSE NULL END"
    : "website_email = NULL, website_email_kind = NULL";
  db.prepare(
    `UPDATE prospects SET ${emailClause}, website_email_page = NULL, website_phone = NULL, source_email = NULL, source_phone = NULL,
      contact_email_override = NULL, contact_phone_override = NULL, personal_wiped_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(p.id);
}

// ---- audit next 20 ---------------------------------------------------------------------

/**
 * Enqueue audits for up to `limit` prospects that have a website, are not
 * excluded (deleted / not a fit / opted out / partial register) and have no
 * audit finished in the last 90 days, oldest first. Deduped on "audit:{id}".
 */
export function auditNext(limit = 20): { queued: number; deduped: number; ids: number[] } {
  const n = Math.max(1, Math.min(20, limit));
  const rows = enquiriesDb()
    .prepare(
      `SELECT id FROM prospects
       WHERE deleted_at IS NULL AND website IS NOT NULL AND fit <> 'not_fit' AND opted_out_at IS NULL AND diffusion <> 'partial'
         AND (latest_audit_id IS NULL OR NOT EXISTS (SELECT 1 FROM audits a WHERE a.id = prospects.latest_audit_id AND a.finished_at > datetime('now', '-90 days')))
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'audit' AND j.dedupe_key = 'audit:' || prospects.id AND j.status IN ('queued', 'running'))
       ORDER BY (latest_audit_id IS NOT NULL), saved_at ASC, id ASC
       LIMIT ?`,
    )
    .all(n) as { id: number }[];
  const out = { queued: 0, deduped: 0, ids: [] as number[] };
  for (const { id } of rows) {
    const r = enqueueAudit(id);
    if (r.deduped) out.deduped++;
    else {
      out.queued++;
      out.ids.push(id);
    }
  }
  return out;
}

// ---- google (place_id only) ---------------------------------------------------------------

export function setGoogleListing(id: number, listing: Prospect["googleListing"], placeId: string | null): ProspectRecord {
  const db = enquiriesDb();
  if (!getProspect(id)) throw new ProspectError("not_found", 404);
  db.prepare(
    "UPDATE prospects SET google_listing = ?, google_place_id = ?, google_confirmed_at = CASE WHEN ? = 'unverified' THEN NULL ELSE datetime('now') END, updated_at = datetime('now') WHERE id = ?",
  ).run(listing, placeId, listing, id);
  return getProspect(id)!;
}
