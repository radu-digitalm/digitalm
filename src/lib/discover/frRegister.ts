// French company register through the API Recherche d'entreprises
// (recherche-entreprises.api.gouv.fr — Sirene/RNE, Licence Ouverte 2.0).
// docs/finder-ux-spec.md §3.4: one scope per postcode / department / radius
// (scopesFor in frRegisterMap.ts), ≤ 40 pages of 25 per scope, ≤ 5 req/s,
// cached 24 h per URL; every row with coordinates is point-in-polygon tested
// before it is kept. Directors, finances and the other personal/financial
// blocks are deleted in slimCompany, before anything is cached or mapped.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { Business, Category, ResolvedArea } from "@/lib/crm/types";
import { SIRET_RE, SOLE_TRADER_NATURE, diffusionOf, mapEstablishment, placeRegisterRow, slimCompany, type RegisterScopeSpec, type SlimCompany } from "./frRegisterMap";

export { SIRET_RE, SOLE_TRADER_NATURE, diffusionOf, mapEstablishment, scopesFor, slimCompany } from "./frRegisterMap";
export type { RegisterScopeSpec, SlimCompany, SlimEtab } from "./frRegisterMap";

type SearchPage = { results: SlimCompany[]; total_results: number; total_pages: number; page: number };

const GAP_MS = 200; // 5 req/s
const PER_PAGE = 25;
export const MAX_PAGES = 40; // 1,000 establishments per scope

async function fetchPage(url: string, signal?: AbortSignal, fresh = false): Promise<SearchPage> {
  const { value, hit } = await cached<SearchPage>("fr_register", { url }, DAY_MS, async () => {
    const res = await spaced("fr_register", GAP_MS, () => fetchJson<Record<string, unknown>>(url, { timeoutMs: 15_000, signal }));
    const d = res.data;
    const results = Array.isArray(d.results) ? d.results.map(slimCompany).filter((x): x is SlimCompany => x !== null) : [];
    return {
      results,
      total_results: Number(d.total_results ?? results.length) || 0,
      total_pages: Number(d.total_pages ?? 1) || 1,
      page: Number(d.page ?? 1) || 1,
    };
  }, { fresh });
  if (!hit) countApiUsage("fr_register");
  return value;
}

/** "did not answer" (timeout / network) or "was busy" (429 / 5xx) — never an HTTP code. */
export function registerReason(e: unknown): "did not answer" | "was busy" {
  return e instanceof HttpError && (e.status === 429 || e.status >= 500) ? "was busy" : "did not answer";
}

export type RegisterRow = Business & { inside: "yes" | "approx" };

export type ScopeRead = { rows: RegisterRow[]; dropped: number; totalPages: number; pagesCapped: boolean; totalResults: number };

/**
 * Read one scope page by page. `inside` decides polygon membership for rows
 * with coordinates; `onPage` reports progress after every page. Throws
 * HttpError when the register cannot be reached (the runner marks the scope
 * failed and the search partial).
 */
export async function searchRegisterScope(
  scope: RegisterScopeSpec,
  category: Category,
  area: ResolvedArea,
  inside: (lng: number, lat: number) => boolean,
  opts: { signal?: AbortSignal; onPage?: (pages: number, totalPages: number, found: number) => void; fresh?: boolean } = {},
): Promise<ScopeRead> {
  const rows: RegisterRow[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let totalPages = 1;
  let totalResults = 0;
  const path = scope.mode === "near_point" ? "/near_point" : "/search";
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (opts.signal?.aborted) throw new HttpError("aborted");
    const qs = new URLSearchParams({
      activite_principale: category.naf.join(","),
      etat_administratif: "A",
      page: String(page),
      per_page: String(PER_PAGE),
      ...scope.params,
    });
    const data = await fetchPage(`${HOSTS.frRegister}${path}?${qs.toString()}`, opts.signal, opts.fresh === true);
    totalPages = Math.max(1, data.total_pages);
    totalResults = data.total_results;
    for (const c of data.results) {
      const etabs = c.matching_etablissements && c.matching_etablissements.length > 0 ? c.matching_etablissements : c.siege ? [c.siege] : [];
      for (const e of etabs) {
        const b = mapEstablishment(c, e, area);
        if (!b || seen.has(b.sourceId)) continue;
        seen.add(b.sourceId);
        const placed = placeRegisterRow(b, scope.mode, inside);
        if (!placed.keep) {
          if (placed.inside === "no" && b.geoSource === "source") dropped++;
          continue;
        }
        rows.push({ ...b, inside: placed.inside === "approx" ? "approx" : "yes" });
      }
    }
    opts.onPage?.(page, Math.min(totalPages, MAX_PAGES), rows.length);
    if (data.results.length === 0 || page >= totalPages) break;
  }
  return { rows, dropped, totalPages, pagesCapped: totalPages > MAX_PAGES, totalResults };
}

// ---- live re-check ------------------------------------------------------------------

export type SiretCheck = { found: boolean; active: boolean; diffusion: "full" | "partial"; soleTrader: boolean | null; legalForm: string | null };

/** Live (uncached) status of one SIRET: `/search?q={siret}&per_page=1`. Throws HttpError on network failure. */
export async function recheckSiret(siret: string): Promise<SiretCheck> {
  if (!SIRET_RE.test(siret)) throw new HttpError("bad_siret", 400);
  const url = `${HOSTS.frRegister}/search?${new URLSearchParams({ q: siret, per_page: "1" }).toString()}`;
  const res = await spaced("fr_register", GAP_MS, () => fetchJson<Record<string, unknown>>(url, { timeoutMs: 15_000 }));
  countApiUsage("fr_register");
  const c = Array.isArray(res.data.results) ? slimCompany(res.data.results[0]) : null;
  if (!c) return { found: false, active: false, diffusion: "full", soleTrader: null, legalForm: null };
  const etab = c.matching_etablissements?.find((e) => e.siret === siret) ?? (c.siege?.siret === siret ? c.siege : undefined);
  const active = c.etat_administratif === "A" && (etab ? etab.etat_administratif === "A" : true);
  return {
    found: true,
    active,
    diffusion: diffusionOf(c.statut_diffusion, etab?.statut_diffusion_etablissement),
    soleTrader: c.nature_juridique ? c.nature_juridique === SOLE_TRADER_NATURE : null,
    legalForm: c.nature_juridique ?? null,
  };
}
