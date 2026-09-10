// Discovery orchestration (contract §6 "Search / dedupe / save"): run the
// enabled adapters sequentially inside one time budget, merge across sources,
// mark rows already saved as prospects, record the search and cache the
// result 24 h under "search:{id}" so the save route can re-read exactly what
// the admin ticked.
import { DAY_MS, cacheGet, cacheSet } from "@/lib/crm/apiCache";
import { parseJson } from "@/lib/crm/db";
import { enquiriesDb } from "@/lib/enquiries";
import type { Area, Business, Category, DiscoveryAdapter, DiscoverySource } from "@/lib/crm/types";
import { markAlreadySaved } from "@/lib/prospects/store";
import { companiesHouseAdapter } from "./companiesHouse";
import { mergeBusinesses, type MergedBusiness } from "./dedupe";
import { frRegisterAdapter } from "./frRegister";
import { googleAdapter } from "./google";
import { osmAdapter } from "./overpass";

export { DiscoverError, geocodeArea } from "./geocode";
export { parseCategory, tradeKeyFor, CATEGORIES } from "./categories";
export type { MergedBusiness } from "./dedupe";

export type AdapterResult = { rows: Business[]; partial: boolean; notes: string[] };

/** DiscoveryAdapter plus a richer search that reports partial results and notes. */
export interface RichAdapter extends DiscoveryAdapter {
  searchRich(area: Area, category: Category, opts: { budgetMs: number; signal: AbortSignal }): Promise<AdapterResult>;
}

const googleRich: RichAdapter = {
  ...googleAdapter,
  searchRich: async () => ({ rows: [], partial: false, notes: [] }),
};

export const ADAPTERS: readonly RichAdapter[] = [osmAdapter, frRegisterAdapter, companiesHouseAdapter, googleRich];

export const SOURCE_IDS: readonly DiscoverySource[] = ["osm", "fr_register", "companies_house", "google"];

export const SOURCE_LABELS: Record<DiscoverySource, string> = {
  osm: "OpenStreetMap",
  fr_register: "FR register",
  companies_house: "Companies House",
  google: "Google",
};

/** Attribution line shown under every results table and in RegisterBlock (contract §6). */
export const ATTRIBUTION =
  "Données © les contributeurs d'OpenStreetMap (ODbL) · Sirene/RNE via API Recherche d'entreprises — Licence Ouverte 2.0 · Companies House — OGL v3";

export const SEARCH_BUDGET_MS = 40_000;
export const MAX_ROWS = 300;
const MIN_ADAPTER_BUDGET_MS = 2_000;

export type SearchResult = {
  searchId: number;
  queryArea: string;
  area: Area;
  category: { key: string; label: { fr: string; en: string }; custom: boolean };
  sources: DiscoverySource[];
  rows: MergedBusiness[];
  perSource: Partial<Record<DiscoverySource, number>>;
  partial: boolean;
  notes: string[];
  durationMs: number;
  createdAt: string;
};

/** Sanitise a `sources` field from the request body; unknown → every source. */
export function parseSources(input: unknown): DiscoverySource[] {
  if (!Array.isArray(input)) return [...SOURCE_IDS];
  const out = SOURCE_IDS.filter((s) => input.includes(s));
  return out.length > 0 ? out : [...SOURCE_IDS];
}

function sourceSkipNote(a: RichAdapter, area: Area): string {
  if (a.id === "fr_register") return `FR register skipped: ${area.label} is not in France`;
  if (a.id === "companies_house") return `Companies House skipped: ${area.label} is not in the UK`;
  return `${SOURCE_LABELS[a.id]} skipped for this area`;
}

export async function runSearch(input: {
  queryArea: string;
  area: Area;
  category: Category;
  sources: DiscoverySource[];
  budgetMs?: number;
}): Promise<SearchResult> {
  const started = Date.now();
  const deadline = started + (input.budgetMs ?? SEARCH_BUDGET_MS);
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), deadline - started + 5_000);
  const notes: string[] = [];
  const perSource: Partial<Record<DiscoverySource, number>> = {};
  const collected: Business[] = [];
  let partial = false;

  try {
    for (const adapter of ADAPTERS) {
      if (!input.sources.includes(adapter.id)) continue;
      if (!adapter.enabled()) {
        notes.push(adapter.id === "google" ? "Google Places is off (GOOGLE_PLACES=off)" : `${SOURCE_LABELS[adapter.id]} is off`);
        continue;
      }
      if (!adapter.supports(input.area)) {
        notes.push(sourceSkipNote(adapter, input.area));
        continue;
      }
      const budgetMs = deadline - Date.now();
      if (budgetMs < MIN_ADAPTER_BUDGET_MS) {
        partial = true;
        notes.push(`${SOURCE_LABELS[adapter.id]} skipped (time budget used up)`);
        continue;
      }
      try {
        const r = await adapter.searchRich(input.area, input.category, { budgetMs, signal: controller.signal });
        perSource[adapter.id] = r.rows.length;
        collected.push(...r.rows);
        partial = partial || r.partial;
        notes.push(...r.notes);
      } catch (e) {
        partial = true;
        const code = (e as { code?: string })?.code ?? "error";
        notes.push(`${SOURCE_LABELS[adapter.id]} failed (${code})`);
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }

  let rows = mergeBusinesses(collected);
  if (rows.length > MAX_ROWS) {
    notes.push(`Showing the first ${MAX_ROWS} of ${rows.length} businesses — narrow the area`);
    rows = rows.slice(0, MAX_ROWS);
  }
  markAlreadySaved(rows);

  const durationMs = Date.now() - started;
  const db = enquiriesDb();
  const r = db
    .prepare(
      "INSERT INTO searches (query_area, area, category_key, sources, result_count, per_source, partial, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.queryArea.slice(0, 120),
      JSON.stringify(input.area),
      input.category.key,
      JSON.stringify(input.sources),
      rows.length,
      JSON.stringify(perSource),
      partial ? 1 : 0,
      durationMs,
    );
  const searchId = Number(r.lastInsertRowid);
  const result: SearchResult = {
    searchId,
    queryArea: input.queryArea,
    area: input.area,
    category: { key: input.category.key, label: input.category.label, custom: input.category.custom === true },
    sources: input.sources,
    rows,
    perSource,
    partial,
    notes,
    durationMs,
    createdAt: new Date().toISOString(),
  };
  cacheSet(`search:${searchId}`, "search", result, DAY_MS);
  return result;
}

/** A cached search (24 h), with the already-saved marks refreshed; null when expired. */
export function getSearch(searchId: number): SearchResult | null {
  const result = cacheGet<SearchResult>(`search:${searchId}`);
  if (!result) return null;
  markAlreadySaved(result.rows);
  return result;
}

export type SearchSummary = {
  id: number;
  queryArea: string;
  areaLabel: string;
  countryCode: string;
  categoryKey: string;
  sources: DiscoverySource[];
  resultCount: number;
  perSource: Partial<Record<DiscoverySource, number>>;
  savedCount: number;
  partial: boolean;
  durationMs: number | null;
  createdAt: string;
  cached: boolean;
};

/** Past searches for the /admin/find sidebar, newest first. */
export function listSearches(limit = 20): SearchSummary[] {
  const db = enquiriesDb();
  const rows = db
    .prepare(
      `SELECT s.*, EXISTS (SELECT 1 FROM api_cache c WHERE c.cache_key = 'search:' || s.id AND c.expires_at > datetime('now')) AS cached
       FROM searches s ORDER BY s.id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(100, limit))) as Record<string, unknown>[];
  return rows.map((r) => {
    const area = parseJson<Partial<Area>>(r.area as string, {});
    return {
      id: Number(r.id),
      queryArea: String(r.query_area ?? ""),
      areaLabel: area.label ?? String(r.query_area ?? ""),
      countryCode: area.countryCode ?? "",
      categoryKey: String(r.category_key ?? ""),
      sources: parseJson<DiscoverySource[]>(r.sources as string, []),
      resultCount: Number(r.result_count ?? 0),
      perSource: parseJson<Partial<Record<DiscoverySource, number>>>(r.per_source as string, {}),
      savedCount: Number(r.saved_count ?? 0),
      partial: Number(r.partial ?? 0) === 1,
      durationMs: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
      createdAt: String(r.created_at ?? ""),
      cached: Number(r.cached ?? 0) === 1,
    };
  });
}
