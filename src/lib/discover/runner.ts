// The search runner (docs/finder-ux-spec.md §2.5, §2.6, §3.2–3.8): plans an
// area (estimate → one unit, administrative children or tiles), runs the
// units through Overpass one at a time in the background of the `next start`
// process, then the French register by department / postcode / radius with
// point-in-polygon filtering, merges, fills towns, orders, and persists the
// result after every unit and every register page so the page can poll.
// Exactly one search runs at a time; a restart leaves an `interrupted`
// search that `continueSearch` finishes from the 24 h unit cache.
import { DAY_MS, cacheGet, cacheSet } from "@/lib/crm/apiCache";
import { parseJson } from "@/lib/crm/db";
import { HttpError } from "@/lib/crm/http";
import type { Area, Business, Category, DiscoverySource, ResolvedArea, ResultRow, SearchNote, SearchProgress, SearchResultV2, SearchStatus, SearchSummaryV2 } from "@/lib/crm/types";
import { enquiriesDb } from "@/lib/enquiries";
import { markAlreadySaved } from "@/lib/prospects/store";
import { fetchChildren, fetchCommuneCentres } from "./adminChildren";
import { AreaQueryError } from "./areaQuery";
import { categoryByKey, tradeLabel } from "./categories";
import { companiesHouseKey, searchCompaniesHouse } from "./companiesHouse";
import { mergeBusinesses, type MergedBusiness } from "./dedupe";
import { registerReason, searchRegisterScope, scopesFor, type RegisterRow } from "./frRegister";
import { countryNameOf, finePolygon, frDepartements, frRegionDepartements, frRegions, geoGouv, type GeoCommune } from "./geocode";
import { googlePlacesOn } from "./google";
import { fmtNum, listOf, note, plural } from "./notes";
import { UnitFailure, fetchUnit, mapElement, overpassCount, type OsmBusiness } from "./overpass";
import { RULES_VERSION, repairSearchResult } from "./searchRepair";
import { CHILD_LEVELS, capReached, chooseLevel, findMaxMs, findMaxRows, findMaxUnits, needsSplit, overCap, planUnits, type ChildRel, type PlanMode, type PlanUnit } from "./plan";
import { haversineKm, pointInPolygon } from "./polygon";
import { applyEvent, initialProgress, isInterrupted, legacyStatus, resolveStatus, type ProgressEvent } from "./progress";
import { departementsOfPostcode, nearestCentre, type CentrePoint } from "./townFill";

export const SEARCH_CACHE_MS = DAY_MS;
const HEARTBEAT_MS = 15_000;
const HUGE_RADIUS_KM = 300; // beyond this the estimate gets a shorter server-side timeout so the route stays under its budget
const CANCEL_WAIT_MS = 4_000;
const MAX_TOWN_FILL_UNITS = 20;

/** Error with a stable code and HTTP status for the routes. */
export class RunnerError extends Error {
  code: string;
  status: number;
  detail?: Record<string, unknown>;
  constructor(code: string, status = 409, detail?: Record<string, unknown>) {
    super(code);
    this.name = "RunnerError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type StoredPlan = { expected: number | null; cap: number; mode: PlanMode; estimateMs: number; units: PlanUnit[]; category: Category };

/** A chip of the over-cap gate: a real administrative child by name; `query` is what a click posts as the area (a department code, "Occitanie, France"). */
export type GateUnit = { id: string; label: string; code?: string; countryCode: string; query?: string };

export type PlanOutcome = { gate: "over_cap"; plan: { expected: number | null; cap: number; units: GateUnit[]; estimateMs: number } } | { gate: null; plan: StoredPlan };

// ---- live state ---------------------------------------------------------------------------

type Live = { controller: AbortController; startedAt: number; done: Promise<void> };

function liveMap(): Map<number, Live> {
  const g = globalThis as { __dmFinder?: Map<number, Live> };
  if (!g.__dmFinder) g.__dmFinder = new Map();
  return g.__dmFinder;
}

/** The search currently running in this process, if any. */
export function runningSearch(): { searchId: number; area: string; trade: string } | null {
  for (const [id] of liveMap()) {
    const row = enquiriesDb().prepare("SELECT area, category_key FROM searches WHERE id = ?").get(id) as { area: string; category_key: string } | undefined;
    const area = parseJson<Partial<Area>>(row?.area, {});
    return { searchId: id, area: area.label ?? "", trade: tradeLabelOf(row?.category_key ?? "") };
  }
  return null;
}

function tradeLabelOf(key: string): string {
  return key.startsWith("custom:") ? key.slice(7).replace(/_/g, " ") : (tradeLabel(key) ?? key);
}

function assertNotRunning(): void {
  const running = runningSearch();
  if (running) throw new RunnerError("search_running", 409, running);
}

// ---- planning (§2.5, §2.6) ----------------------------------------------------------------

const REGION_COUNT_TIMEOUT_S = 8; // a region's count gets a short server-side timeout: quick, or gated without one (the gate shows within ~13 s)

function byName<T extends { label: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
}

/**
 * The gate's chips: the area's real administrative children by name, A–Z,
 * from one lightweight lookup at most — geo.gouv for a French region (its
 * departments; already cached by the resolver) or for France (its regions),
 * one Overpass children query for a region or country elsewhere. A
 * department or a town over the cap has hundreds of communes: no chips (the
 * panel says to type a smaller area). Never tiles.
 */
async function gateChildren(area: ResolvedArea, maxUnits: number, signal?: AbortSignal): Promise<GateUnit[]> {
  if (area.countryCode === "FR" && area.kind === "region" && area.admin?.regionCode) {
    const deps = await frRegionDepartements(area.admin.regionCode).catch(() => []);
    return byName(deps.map((d) => ({ id: `dep:${d.code}`, label: d.nom, code: d.code, countryCode: "FR", query: d.code })));
  }
  if (area.countryCode === "FR" && area.kind === "country") {
    const regions = await frRegions().catch(() => []);
    return byName(regions.map((r) => ({ id: `reg:${r.code}`, label: r.nom, code: r.code, countryCode: "FR", query: `${r.nom}, France` })));
  }
  if ((area.kind !== "region" && area.kind !== "country") || area.areaSelector.kind === "around") return [];
  const levels = area.kind === "country" ? [4, 6, 8] : [6, 4, 8];
  for (const level of levels) {
    const list = await fetchChildren(area.areaSelector, level, signal).catch((e: unknown) => {
      if (e instanceof HttpError && e.code === "aborted") throw e;
      return [] as ChildRel[];
    });
    const pick = chooseLevel((l) => (l === level ? list : undefined), maxUnits);
    if (pick) return byName(pick.children.map((c) => ({ id: `r${c.relId}`, label: c.name, ...(c.code ? { code: c.code } : {}), countryCode: area.countryCode })));
  }
  return [];
}

/**
 * Estimate the area (one cached Overpass count — never for a country, a
 * short one for a region), answer the over-cap gate with the children by
 * name, or — once the owner has chosen — fetch the administrative children
 * the split needs and return the unit plan.
 */
export async function planSearch(area: ResolvedArea, category: Category, opts: { confirmCap?: boolean; signal?: AbortSignal } = {}): Promise<PlanOutcome> {
  const cap = findMaxRows();
  const maxUnits = findMaxUnits();
  const big = area.kind === "region" || area.kind === "country";
  const huge = area.radiusKm > HUGE_RADIUS_KM;
  let expected: number | null = null;
  let estimateMs = 0;
  // A country is never one request and its count is never quick: it is gated without an estimate (§2.6).
  if (area.kind !== "country") {
    try {
      ({ expected, ms: estimateMs } = await overpassCount(area.areaSelector, category, { signal: opts.signal, timeoutS: area.kind === "region" ? REGION_COUNT_TIMEOUT_S : huge ? 20 : 30 }));
    } catch (e) {
      if (e instanceof AreaQueryError) throw new RunnerError("bad_area", 400);
      throw e;
    }
  }
  // A region or country whose count the map service could not give is still split and gated: it is never one request.
  const mustSplit = needsSplit(expected) || (expected === null && big);
  const mustGate = overCap(expected, cap) || (expected === null && big);
  if (mustGate && !opts.confirmCap) {
    const units = await gateChildren(area, maxUnits, opts.signal);
    return { gate: "over_cap", plan: { expected, cap, units, estimateMs } };
  }
  let children: ChildRel[] | null = null;
  const canSplit = area.areaSelector.kind !== "around" && area.kind !== "place";
  if (canSplit && mustSplit) {
    for (const level of CHILD_LEVELS) {
      const list = await fetchChildren(area.areaSelector, level, opts.signal).catch((e: unknown) => {
        if (e instanceof HttpError && e.code === "aborted") throw e;
        return [] as ChildRel[];
      });
      const pick = chooseLevel((l) => (l === level ? list : undefined), maxUnits);
      if (pick) {
        children = pick.children;
        break;
      }
    }
  }
  const { mode, units } = planUnits({ area, expected, children, maxUnits, forceSplit: mustSplit });
  return { gate: null, plan: { expected, cap, mode, estimateMs, units, category } };
}

// ---- rows ---------------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function distanceOf(b: Pick<Business, "lat" | "lng" | "geoSource">, center: { lat: number; lng: number }): number | null {
  return b.geoSource === "source" && typeof b.lat === "number" && typeof b.lng === "number" ? round1(haversineKm(center, { lat: b.lat, lng: b.lng })) : null;
}

type OsmRow = ResultRow & { countrySource: "source" | "area"; unitId: string; readAt: string };

function osmToRow(b: OsmBusiness, unitId: string, readAt: string, area: ResolvedArea): OsmRow {
  const { socials, countrySource, ...rest } = b;
  const row: OsmRow = {
    ...rest,
    key: `osm:${b.sourceId}`,
    sources: ["osm"],
    provenance: {
      name: "osm",
      ...(b.geoSource === "source" ? { geo: "osm" as const } : {}),
      ...(b.addressLine || b.postcode ? { address: "osm" as const } : {}),
      ...(b.website ? { website: "osm" as const } : {}),
      ...(b.phone ? { phone: "osm" as const } : {}),
      ...(b.email ? { email: "osm" as const } : {}),
    },
    inside: "yes",
    distanceKm: distanceOf(b, area.center),
    countryName: countryNameOf(b.countryCode, area.countryCode === b.countryCode ? area.countryName : undefined),
    countrySource,
    unitId,
    readAt,
  };
  if (socials) row.socials = socials;
  return row;
}

function mergedToRow(m: MergedBusiness, ctx: { area: ResolvedArea; osm: Map<string, OsmRow>; register: Map<string, RegisterRow>; readAt: string }): ResultRow {
  const { members, ...rest } = m;
  const osmKey = members.find((k) => k.startsWith("osm:"));
  const osm = osmKey ? ctx.osm.get(osmKey) : undefined;
  const registerKey = members.find((k) => k.startsWith("fr_register:"));
  const register = registerKey ? ctx.register.get(registerKey) : undefined;
  const inside: ResultRow["inside"] = osm ? "yes" : register ? register.inside : "approx";
  const row: ResultRow = {
    ...rest,
    inside,
    distanceKm: inside === "yes" ? distanceOf(m, ctx.area.center) : null,
    countryName: countryNameOf(m.countryCode, ctx.area.countryCode === m.countryCode ? ctx.area.countryName : undefined),
    countrySource: osm ? osm.countrySource : "source",
    readAt: osm?.readAt ?? ctx.readAt,
  };
  if (osm?.socials) row.socials = osm.socials;
  if (osm?.unitId) row.unitId = osm.unitId;
  return row;
}

/** Final order (§3.7): inside yes → approx → no; distance ascending (nulls last); name. */
export function orderRows(rows: ResultRow[]): ResultRow[] {
  const rank = { yes: 0, approx: 1, no: 2 } as const;
  return [...rows].sort((a, b) => {
    const r = rank[a.inside] - rank[b.inside];
    if (r !== 0) return r;
    if (a.distanceKm === null && b.distanceKm !== null) return 1;
    if (a.distanceKm !== null && b.distanceKm === null) return -1;
    if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.name.localeCompare(b.name);
  });
}

function countPerSource(rows: readonly ResultRow[]): Partial<Record<DiscoverySource, number>> {
  const out: Partial<Record<DiscoverySource, number>> = {};
  for (const r of rows) for (const s of r.sources) out[s] = (out[s] ?? 0) + 1;
  return out;
}

// ---- persistence --------------------------------------------------------------------------

type SearchRow = {
  id: number;
  query_area: string;
  area: string;
  category_key: string;
  sources: string;
  result_count: number;
  per_source: string;
  saved_count: number;
  partial: number;
  duration_ms: number | null;
  created_at: string;
  status: string | null;
  progress: string | null;
  plan: string | null;
  dismissed: string | null;
};

function readRow(id: number): SearchRow | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  return (enquiriesDb().prepare("SELECT * FROM searches WHERE id = ?").get(id) as SearchRow | undefined) ?? null;
}

function isoOf(sql: string): string {
  const d = new Date(sql.includes("T") ? sql : `${sql.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function writeProgress(id: number, progress: SearchProgress, found: number, perSource: Partial<Record<DiscoverySource, number>>, durationMs: number | null): void {
  enquiriesDb()
    .prepare("UPDATE searches SET status = ?, progress = ?, result_count = ?, per_source = ?, partial = ?, duration_ms = ? WHERE id = ?")
    .run(progress.status, JSON.stringify(progress), found, JSON.stringify(perSource), progress.status === "partial" ? 1 : 0, durationMs, id);
}

function writeResult(result: SearchResultV2): void {
  const { alternatives: _alternatives, ...stored } = result;
  cacheSet(`search:${result.searchId}`, "search", stored, SEARCH_CACHE_MS);
}

// ---- start / continue --------------------------------------------------------------------

export type StartInput = { queryArea: string; area: ResolvedArea; category: Category; sources: DiscoverySource[]; plan: StoredPlan; fresh?: boolean };

/** Insert the `searches` row, seed the cache, kick the background run. Throws RunnerError search_running. */
export function startSearch(input: StartInput): { searchId: number } {
  assertNotRunning();
  const now = new Date().toISOString();
  const progress = initialProgress({ units: input.plan.units, expected: input.plan.expected, cap: input.plan.cap, at: now });
  const db = enquiriesDb();
  const r = db
    .prepare(
      "INSERT INTO searches (query_area, area, category_key, sources, result_count, per_source, partial, duration_ms, status, progress, plan, dismissed) VALUES (?, ?, ?, ?, 0, '{}', 0, NULL, 'running', ?, ?, '[]')",
    )
    .run(input.queryArea.slice(0, 120), JSON.stringify(input.area), input.category.key, JSON.stringify(input.sources), JSON.stringify(progress), JSON.stringify(input.plan));
  const searchId = Number(r.lastInsertRowid);
  const result: SearchResultV2 = {
    version: 2,
    rulesVersion: RULES_VERSION,
    searchId,
    queryArea: input.queryArea,
    area: input.area,
    category: { key: input.category.key, label: input.category.label, custom: input.category.custom === true },
    sources: input.sources,
    rows: [],
    total: 0,
    perSource: {},
    progress,
    notes: [],
    durationMs: null,
    createdAt: now,
  };
  writeResult(result);
  launch(searchId, { area: input.area, category: input.category, sources: input.sources, plan: input.plan, progress, createdAt: now, queryArea: input.queryArea, fresh: input.fresh === true });
  return { searchId };
}

/** Re-run an interrupted / partial / cancelled search in place (finished units come from the 24 h cache). */
export function continueSearch(id: number): { searchId: number } {
  const row = readRow(id);
  if (!row) throw new RunnerError("not_found", 404);
  const cached = cacheGet<SearchResultV2>(`search:${id}`);
  if (!cached) throw new RunnerError("search_expired", 410);
  const status = statusOf(row);
  if (liveMap().has(id) || status === "running") throw new RunnerError("not_continuable", 409, { status: "running" });
  if (status !== "interrupted" && status !== "partial" && status !== "cancelled") throw new RunnerError("not_continuable", 409, { status });
  assertNotRunning();
  const plan = parseJson<StoredPlan | null>(row.plan, null);
  const area = parseJson<ResolvedArea | null>(row.area, null);
  if (!plan || !area || !Array.isArray(plan.units) || !plan.category) throw new RunnerError("not_continuable", 409, { status });
  const now = new Date().toISOString();
  const progress = applyEvent(parseJson<SearchProgress>(row.progress, initialProgress({ units: plan.units, expected: plan.expected, cap: plan.cap, at: now })), { type: "resumed", at: now });
  writeProgress(id, progress, 0, {}, null);
  launch(id, { area, category: plan.category, sources: parseJson<DiscoverySource[]>(row.sources, ["osm", "fr_register"]), plan, progress, createdAt: isoOf(row.created_at), queryArea: row.query_area, fresh: false });
  return { searchId: id };
}

/** Abort a running search; resolves with the status once the run has wound down (≤ 4 s), or the current status. */
export async function cancelSearch(id: number): Promise<{ status: SearchStatus }> {
  const row = readRow(id);
  if (!row) throw new RunnerError("not_found", 404);
  const live = liveMap().get(id);
  if (!live) return { status: statusOf(row) };
  live.controller.abort();
  await Promise.race([live.done, new Promise((r) => setTimeout(r, CANCEL_WAIT_MS))]);
  return { status: statusOf(readRow(id) ?? row) };
}

/** `fresh`: a "Run again" — every unit and register page is read anew instead of from the 24 h cache. */
type RunContext = { area: ResolvedArea; category: Category; sources: DiscoverySource[]; plan: StoredPlan; progress: SearchProgress; createdAt: string; queryArea: string; fresh: boolean };

function launch(searchId: number, ctx: RunContext): void {
  const controller = new AbortController();
  const live: Live = { controller, startedAt: Date.now(), done: Promise.resolve() };
  liveMap().set(searchId, live);
  live.done = run(searchId, ctx, controller.signal)
    .catch((e: unknown) => {
      console.error(`finder: search ${searchId} crashed`, e instanceof Error ? e.message.slice(0, 300) : String(e));
      try {
        const at = new Date().toISOString();
        const failed = applyEvent(ctx.progress, { type: "finished", status: "failed", at });
        writeProgress(searchId, failed, 0, {}, Date.now() - live.startedAt);
      } catch {
        // nothing more to do
      }
    })
    .finally(() => {
      liveMap().delete(searchId);
    });
}

// ---- the run ------------------------------------------------------------------------------

async function run(searchId: number, ctx: RunContext, signal: AbortSignal): Promise<void> {
  const { area, category, sources, plan } = ctx;
  const started = Date.now();
  const cap = plan.cap;
  const maxMs = findMaxMs();
  let progress = ctx.progress;
  const notes: SearchNote[] = [];
  const osmRows: OsmRow[] = [];
  const osmByKey = new Map<string, OsmRow>();
  const registerRows: RegisterRow[] = [];
  const registerByKey = new Map<string, RegisterRow>();
  const chRows: Business[] = [];
  let capped = false;
  let timeLimit = false;
  let cancelled = false;
  const trade = plural(category.label.en);

  const skeleton = (): SearchResultV2 => ({
    version: 2,
    rulesVersion: RULES_VERSION,
    searchId,
    queryArea: ctx.queryArea,
    area,
    category: { key: category.key, label: category.label, custom: category.custom === true },
    sources,
    rows: [],
    total: 0,
    perSource: {},
    progress,
    notes: [],
    durationMs: null,
    createdAt: ctx.createdAt,
  });

  const emit = (e: ProgressEvent) => {
    progress = applyEvent(progress, e);
    ctx.progress = progress; // the crash handler in launch() writes the latest state
  };
  const saveProgress = () => writeProgress(searchId, progress, progress.found, countPerSource(osmRows), null);
  const saveRows = () => {
    const result = skeleton();
    result.rows = osmRows;
    result.total = osmRows.length;
    result.perSource = countPerSource(osmRows);
    result.notes = notes;
    writeResult(result);
    saveProgress();
  };
  const heartbeat = setInterval(() => {
    try {
      emit({ type: "heartbeat", at: new Date().toISOString() });
      saveProgress();
    } catch {
      // the next event will retry
    }
  }, HEARTBEAT_MS);
  const isAbort = (e: unknown) => signal.aborted || (e instanceof HttpError && e.code === "aborted");

  try {
    // ---- OpenStreetMap units, from the centre outward ----------------------------------
    emit({ type: "stage", stage: "osm", at: new Date().toISOString() });
    saveProgress();
    let stopped = false;
    for (const unit of plan.units) {
      const at = () => new Date().toISOString();
      if (signal.aborted) {
        cancelled = true;
        break;
      }
      if (stopped) {
        emit({ type: "unit_skipped", id: unit.id, at: at() });
        continue;
      }
      if (capReached(osmRows.length, cap)) {
        capped = true;
        stopped = true;
        emit({ type: "unit_skipped", id: unit.id, at: at() });
        continue;
      }
      if (Date.now() - started > maxMs) {
        timeLimit = true;
        stopped = true;
        emit({ type: "unit_skipped", id: unit.id, at: at() });
        continue;
      }
      emit({ type: "unit_start", id: unit.id, at: at() });
      saveProgress();
      try {
        const read = await fetchUnit(unit, category, {
          signal,
          fresh: ctx.fresh,
          onRetry: (until) => {
            emit({ type: "retrying", until, at: at() });
            saveProgress();
          },
        });
        let found = 0;
        for (const el of read.elements) {
          const b = mapElement(el, area, category);
          if (!b) continue;
          const row = osmToRow(b, unit.id, read.readAt, area);
          if (osmByKey.has(row.key)) continue;
          osmByKey.set(row.key, row);
          osmRows.push(row);
          found++;
        }
        emit({ type: "unit_done", id: unit.id, found, truncated: read.truncated, at: at() });
        if (read.truncated) notes.push(note("unit_truncated", { unit: unit.label, trade }));
        emit({ type: "found", found: osmRows.length, at: at() });
        saveRows();
      } catch (e) {
        if (isAbort(e)) {
          cancelled = true;
          break;
        }
        if (e instanceof UnitFailure) {
          console.warn(`finder: search ${searchId} unit "${unit.label}" failed (${e.error})`);
          emit({ type: "unit_failed", id: unit.id, error: e.error, at: at() });
          saveProgress();
          continue;
        }
        throw e;
      }
    }
    if (signal.aborted) cancelled = true;

    // ---- French company register ------------------------------------------------------
    if (!cancelled && sources.includes("fr_register")) {
      if (area.countryCode !== "FR") notes.push(note("register_not_france", { area: area.label }));
      else if (category.naf.length === 0) notes.push(note("register_no_code"));
      else await registerPhase();
    }

    // ---- Companies House, Google ------------------------------------------------------
    if (!cancelled && sources.includes("companies_house")) {
      if (!companiesHouseKey()) notes.push(note("ch_off"));
      else if (area.countryCode !== "GB") {
        // nothing to say: the register of another country
      } else if (area.kind !== "town" || !area.admin?.locality) notes.push(note("ch_needs_town"));
      else {
        try {
          const r = await searchCompaniesHouse(area, category, signal);
          chRows.push(...r.rows);
        } catch (e) {
          if (isAbort(e)) cancelled = true;
          else console.error("finder: Companies House failed", e instanceof HttpError ? e.code : "error");
        }
      }
    }
    if (sources.includes("google") && !googlePlacesOn()) notes.push(note("google_off"));

    // ---- merge, town fill, order ------------------------------------------------------
    // The stage is visible: the page reads "Placing on the map and removing duplicates…" while this runs.
    emit({ type: "stage", stage: "merge", at: new Date().toISOString() });
    saveProgress();
    const mergedAt = new Date().toISOString();
    const beforeMerge = osmRows.length + registerRows.length + chRows.length;
    const merged = mergeBusinesses([...osmRows, ...registerRows, ...chRows]);
    if (beforeMerge > merged.length) notes.push(note("duplicates_removed", { n: beforeMerge - merged.length }));
    let rows = merged.map((m) => mergedToRow(m, { area, osm: osmByKey, register: registerByKey, readAt: mergedAt }));
    markAlreadySaved(rows);
    if (!cancelled) await fillTowns(rows, area, plan, progress, signal).catch(() => undefined);
    const hidden = new Set(parseJson<string[]>(readRow(searchId)?.dismissed, []));
    for (const r of rows) if (hidden.has(r.key)) r.hidden = true;
    rows = orderRows(rows);
    // The cap is a promise about the list ("one search holds 2,000"): a big last unit or the register can overshoot it,
    // so the ordered list is cut to the cap — the rows nearest the centre survive, which is what the capped note says.
    if (capped && rows.length > cap) rows = rows.slice(0, cap);
    const assumed = rows.filter((r) => r.countrySource === "area").length;
    if (assumed > 0 && area.kind === "place") notes.push(note("country_assumed", { n: assumed }));

    emit({ type: "merged", found: rows.length, at: new Date().toISOString() });
    const status = resolveStatus(progress, { cancelled, capped, timeLimit });
    const unitsDone = progress.units.filter((u) => u.state === "done");
    const failedUnits = progress.units.filter((u) => u.state === "failed");
    if (status === "capped") {
      notes.push(
        note("capped", { cap, expected: plan.expected === null ? "" : plan.expected, trade, area: area.label, done: unitsDone.length, total: plan.units.length, list: listOf(unitsDone.map((u) => u.label)) }),
      );
    }
    if (failedUnits.length > 0) notes.push(note("units_failed", { list: listOf(failedUnits.map((u) => u.label)) }));
    if (timeLimit) notes.push(note("time_limit", { minutes: Math.round(maxMs / 60_000), done: unitsDone.length, total: plan.units.length }));
    if (plan.expected === null && plan.units.length > 1) notes.push(note("estimate_unknown"));
    const finishedAt = new Date().toISOString();
    emit({ type: "finished", status, at: finishedAt });
    const result = skeleton();
    result.rows = rows;
    result.total = rows.length;
    result.perSource = countPerSource(rows);
    result.notes = notes;
    result.durationMs = Date.now() - started;
    writeResult(result);
    writeProgress(searchId, progress, rows.length, result.perSource, result.durationMs);
  } finally {
    clearInterval(heartbeat);
  }

  async function registerPhase(): Promise<void> {
    const at = () => new Date().toISOString();
    const done = progress.units.filter((u) => u.state === "done");
    const names: Record<string, string> = {};
    if ((area.kind === "region" || area.kind === "country") && plan.units.length <= 1) {
      // a single-unit region or country: department names for the labels come from geo.gouv (cached 30 d)
      const list = area.kind === "country" ? await frDepartements().catch(() => []) : area.admin?.regionCode ? await frRegionDepartements(area.admin.regionCode).catch(() => []) : [];
      for (const d of list) names[d.code] = d.nom;
    }
    const scopes = scopesFor(area, done, names, plan.units.length <= 1);
    if (scopes.length === 0) return;
    emit({ type: "stage", stage: "register", at: at() });
    emit({ type: "scopes", scopes: scopes.map((s) => ({ id: s.id, label: s.label })), at: at() });
    saveProgress();
    const polygon = (await finePolygon(area)) ?? area.polygon;
    const [s, w, n, e] = area.bbox;
    const inside = polygon ? (lng: number, lat: number) => pointInPolygon(lng, lat, polygon) : (lng: number, lat: number) => lat >= s && lat <= n && lng >= w && lng <= e;
    let dropped = 0;
    let failedNote = false;
    for (const scope of scopes) {
      if (signal.aborted) {
        cancelled = true;
        return;
      }
      emit({ type: "scope_start", id: scope.id, at: at() });
      saveProgress();
      try {
        const read = await searchRegisterScope(scope, category, area, inside, {
          signal,
          fresh: ctx.fresh,
          onPage: (pages, totalPages, found) => {
            emit({ type: "scope_page", id: scope.id, pages, totalPages, found, at: at() });
            saveProgress();
          },
        });
        for (const r of read.rows) {
          const key = `fr_register:${r.sourceId}`;
          if (registerByKey.has(key)) continue;
          registerByKey.set(key, r);
          registerRows.push(r);
        }
        dropped += read.dropped;
        if (read.pagesCapped) notes.push(note("register_pages_capped", { total: read.totalResults, trade, scope: scope.label }));
        emit({ type: "scope_done", id: scope.id, at: at() });
      } catch (e) {
        if (isAbort(e)) {
          cancelled = true;
          return;
        }
        emit({ type: "scope_failed", id: scope.id, at: at() });
        if (!failedNote) {
          notes.push(note("register_failed", { reason: registerReason(e) }));
          failedNote = true;
        }
      }
      saveProgress();
    }
    if (dropped > 0) notes.push(note("register_outside_dropped", { n: dropped, area: area.label }));
  }
}

// ---- town fill (§3.8) ---------------------------------------------------------------------

async function fillTowns(rows: ResultRow[], area: ResolvedArea, plan: StoredPlan, progress: SearchProgress, signal: AbortSignal): Promise<void> {
  const need = rows.filter((r) => !r.city && r.geoSource === "source" && typeof r.lat === "number" && typeof r.lng === "number");
  if (need.length === 0) return;
  let points: CentrePoint[] = [];
  let fallback = area.countryCode !== "FR";
  if (area.countryCode === "FR") {
    const deps = new Set<string>();
    if (area.admin?.departement) deps.add(area.admin.departement);
    for (const r of need) for (const d of departementsOfPostcode(r.postcode)) deps.add(d);
    for (const u of progress.units) if (u.state === "done" && u.code && /^(0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/.test(u.code)) deps.add(u.code);
    if (deps.size === 0 && area.admin?.departements) for (const d of area.admin.departements) deps.add(d);
    for (const dep of [...deps].slice(0, 30)) {
      try {
        const communes = await geoGouv<GeoCommune[]>(`/departements/${encodeURIComponent(dep)}/communes?fields=nom,code,centre,codesPostaux`, { signal });
        for (const c of Array.isArray(communes) ? communes : []) {
          if (!c.centre?.coordinates) continue;
          const [lng, lat] = c.centre.coordinates;
          const p: CentrePoint = { name: c.nom, lat, lng, code: c.code };
          if (c.codesPostaux?.[0]) p.postcode = c.codesPostaux[0];
          points.push(p);
        }
      } catch {
        fallback = true;
      }
    }
  }
  if (fallback || points.length === 0) {
    if (plan.mode === "children") {
      // One request per finished child (its own area), at most 20.
      const units = plan.units.filter((u) => progress.units.find((p) => p.id === u.id)?.state === "done").slice(0, MAX_TOWN_FILL_UNITS);
      for (const u of units) {
        try {
          points = points.concat(await fetchCommuneCentres(u.selector, u.bbox, signal));
        } catch {
          // the rows keep "town unknown"
        }
      }
    } else {
      // A single unit or tiles: one request over the area's bounding box (no dependency on the area being generated).
      try {
        points = points.concat(await fetchCommuneCentres(null, area.bbox, signal));
      } catch {
        // the rows keep "town unknown"
      }
    }
  }
  if (points.length === 0) return;
  for (const r of need) {
    const c = nearestCentre(points, r.lat!, r.lng!);
    if (!c) continue;
    r.city = c.name;
    if (!r.postcode && c.postcode) r.postcode = c.postcode;
    r.cityApprox = true;
  }
}

// ---- reads --------------------------------------------------------------------------------

function statusOf(row: SearchRow): SearchStatus {
  const progress = parseJson<SearchProgress | null>(row.progress, null);
  const status = legacyStatus(row.status, row.partial);
  if (status === "running" && progress && isInterrupted(progress, liveMap().has(row.id))) return "interrupted";
  if (status === "running" && !progress) return "interrupted";
  return status;
}

type LegacyResult = { searchId: number; queryArea: string; area: Area; category: SearchResultV2["category"]; sources: DiscoverySource[]; rows: MergedBusiness[]; perSource: SearchResultV2["perSource"]; partial: boolean; notes: string[]; durationMs: number; createdAt: string };

/** A v1 cached result (bbox search, string notes) read as v2: approximate outline, rows "yes", distances computed. */
function upgradeLegacy(res: LegacyResult, row: SearchRow | null): SearchResultV2 {
  const a = res.area;
  const center = a.center;
  const area: ResolvedArea = {
    ...a,
    kind: a.admin?.inseeCode ? "town" : a.admin?.departement ? "department" : "place",
    countryName: countryNameOf(a.countryCode),
    polygon: null,
    polygonApprox: true,
    areaSelector: { kind: "around", lat: center.lat, lng: center.lng, m: 4000 },
    radiusKm: haversineKm(center, { lat: a.bbox[2], lng: a.bbox[3] }),
  };
  const at = res.createdAt;
  const status = res.partial ? "partial" : "done";
  let progress = initialProgress({ units: [{ id: "legacy", label: a.label, center }], expected: null, cap: findMaxRows(), at });
  progress = applyEvent(progress, { type: "unit_done", id: "legacy", found: res.rows.length, at });
  progress = applyEvent(progress, { type: "merged", found: res.rows.length, at });
  progress = applyEvent(progress, { type: "finished", status, at });
  const rows: ResultRow[] = res.rows.map((m) => {
    const { members: _m, ...rest } = m as MergedBusiness;
    return { ...rest, inside: "yes", distanceKm: distanceOf(m, center), countryName: countryNameOf(m.countryCode), countrySource: "area", readAt: at };
  });
  return {
    version: 2,
    searchId: res.searchId,
    queryArea: res.queryArea,
    area,
    category: res.category,
    sources: res.sources,
    rows,
    total: rows.length,
    perSource: res.perSource,
    progress,
    notes: [],
    durationMs: res.durationMs,
    createdAt: row ? isoOf(row.created_at) : at,
  };
}

/**
 * The cached search (24 h) with the fresh progress/status from the
 * `searches` row, hidden marks and already-saved marks; null when expired.
 * With `slice` (`?after=K&v=V`) only the rows from index K are returned —
 * and only those are checked against saved prospects — unless the list
 * version moved, in which case the whole list comes back.
 */
export function getSearch(searchId: number, slice?: { after: number | null; version: number | null }): SearchResultV2 | null {
  const raw = cacheGet<SearchResultV2 | LegacyResult>(`search:${searchId}`);
  if (!raw) return null;
  const row = readRow(searchId);
  // A result cached under older derivation rules is brought up to date (and written back) before anything reads it.
  if ("version" in raw && raw.version === 2) repairSearchResult(raw, `search:${searchId}`);
  const result: SearchResultV2 = "version" in raw && raw.version === 2 ? raw : upgradeLegacy(raw as LegacyResult, row);
  if (row) {
    const progress = parseJson<SearchProgress | null>(row.progress, null);
    if (progress) result.progress = progress;
    const status = statusOf(row);
    if (status !== result.progress.status) {
      result.progress = { ...result.progress, status };
      if (status === "interrupted" && !result.notes.some((n) => n.code === "interrupted")) result.notes = [...result.notes, note("interrupted")];
    }
    const hidden = new Set(parseJson<string[]>(row.dismissed, []));
    for (const r of result.rows) {
      if (hidden.has(r.key)) r.hidden = true;
      else delete r.hidden;
    }
  }
  result.total = result.rows.length;
  const out = slice ? sliceResult(result, slice.after, slice.version) : result;
  markAlreadySaved(out.rows);
  return out;
}

/** `?after=K&v=V`: the rows from index K when the list version matches, else the whole list (`total` keeps the full length). */
export function sliceResult(result: SearchResultV2, after: number | null, version: number | null): SearchResultV2 {
  if (after === null || after <= 0 || version === null || version !== result.progress.rowsVersion) return result;
  return { ...result, rows: result.rows.slice(after) };
}

function summaryOf(row: SearchRow, cached: boolean): SearchSummaryV2 {
  const area = parseJson<Partial<ResolvedArea>>(row.area, {});
  const status = statusOf(row);
  return {
    id: row.id,
    queryArea: row.query_area,
    areaLabel: area.label ?? row.query_area,
    areaKind: area.kind ?? null,
    countryCode: area.countryCode ?? "",
    countryName: area.countryName ?? countryNameOf(area.countryCode ?? ""),
    categoryKey: row.category_key,
    categoryLabel: tradeLabelOf(row.category_key),
    sources: parseJson<DiscoverySource[]>(row.sources, []),
    resultCount: Number(row.result_count ?? 0),
    perSource: parseJson<Partial<Record<DiscoverySource, number>>>(row.per_source, {}),
    savedCount: Number(row.saved_count ?? 0),
    status: !cached && status !== "running" ? "expired" : status,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    createdAt: isoOf(row.created_at),
    cached,
  };
}

/** Past searches, newest first. */
export function listSearches(limit = 20): SearchSummaryV2[] {
  const rows = enquiriesDb()
    .prepare(
      `SELECT s.*, EXISTS (SELECT 1 FROM api_cache c WHERE c.cache_key = 'search:' || s.id AND c.expires_at > datetime('now')) AS cached
       FROM searches s ORDER BY s.id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(100, limit))) as (SearchRow & { cached: number })[];
  return rows.map((r) => summaryOf(r, Number(r.cached) === 1));
}

/** One search's summary (the prospect page's "Found by the search …" line). */
export function searchSummary(id: number): SearchSummaryV2 | null {
  const row = readRow(id);
  if (!row) return null;
  const cached = cacheGet<unknown>(`search:${id}`) !== null;
  return summaryOf(row, cached);
}

/** "Not this one": remember (or forget) a row key on the search; returns the hidden keys. */
export function dismissSearchRow(searchId: number, key: string, undo = false): { hidden: string[] } {
  const row = readRow(searchId);
  if (!row) throw new RunnerError("not_found", 404);
  const cached = cacheGet<SearchResultV2 | LegacyResult>(`search:${searchId}`);
  if (!cached) throw new RunnerError("search_expired", 410);
  if (!cached.rows.some((r) => r.key === key)) throw new RunnerError("not_found", 404, { key });
  const hidden = new Set(parseJson<string[]>(row.dismissed, []));
  if (undo) hidden.delete(key);
  else if (hidden.size < 5000) hidden.add(key);
  const list = [...hidden];
  enquiriesDb().prepare("UPDATE searches SET dismissed = ? WHERE id = ?").run(JSON.stringify(list), searchId);
  return { hidden: list };
}

/** The category a stored search used (fixed key or the custom trade kept in the plan). */
export function categoryOfSearch(row: { category_key: string; plan: string | null }): Category | null {
  const plan = parseJson<StoredPlan | null>(row.plan, null);
  return plan?.category ?? categoryByKey(row.category_key);
}
