// French company register through the API Recherche d'entreprises
// (recherche-entreprises.api.gouv.fr — Sirene/RNE, Licence Ouverte 2.0).
// Contract §6 "fr_register": one request per postcode (else department, else
// lat/long/radius ≤ 50 km) and page, ≤ 10 pages, ≤ 5 req/s, cached 24 h per
// URL. Directors, finances and the other personal/financial blocks are
// deleted here, before the payload is cached or mapped — nothing downstream
// ever sees them.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { Area, Business, Category } from "@/lib/crm/types";
import { bboxRadiusKm } from "./geocode";
import { SIRET_RE, SOLE_TRADER_NATURE, mapEstablishment, slimCompany, type SlimCompany } from "./frRegisterMap";
import type { AdapterResult, RichAdapter } from "./index";

export { SIRET_RE, SOLE_TRADER_NATURE, mapEstablishment, slimCompany } from "./frRegisterMap";
export type { SlimCompany, SlimEtab } from "./frRegisterMap";

type SearchPage = { results: SlimCompany[]; total_results: number; total_pages: number; page: number };


const GAP_MS = 200; // 5 req/s
const PER_PAGE = 25;
const MAX_PAGES = 10;
const MAX_RADIUS_KM = 50;
const PAGE_RESERVE_MS = 1_500;

async function fetchPage(url: string, signal: AbortSignal): Promise<SearchPage> {
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
  });
  if (!hit) countApiUsage("fr_register");
  return value;
}

/** Scopes to query: one per postcode, else the department, else a radius around the centre. */
function scopesFor(area: Area): Record<string, string>[] {
  const postcodes = (area.admin?.postcodes ?? []).filter((p) => /^\d{5}$/.test(p));
  // A commune has a handful of postcodes; a department has hundreds — use departement= then.
  if (postcodes.length > 0 && postcodes.length <= 12) return postcodes.map((code_postal) => ({ code_postal }));
  if (area.admin?.departement) return [{ departement: area.admin.departement }];
  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Math.ceil(bboxRadiusKm(area))));
  return [{ lat: area.center.lat.toFixed(5), long: area.center.lng.toFixed(5), radius: String(radius) }];
}

export async function searchFrRegister(area: Area, category: Category, opts: { budgetMs: number; signal: AbortSignal }): Promise<AdapterResult> {
  const deadline = Date.now() + opts.budgetMs;
  const rows: Business[] = [];
  const notes: string[] = [];
  let partial = false;
  if (category.naf.length === 0) return { rows, partial, notes: ["FR register: no NAF code for this trade (OSM only)"] };
  const seen = new Set<string>();
  const scopes = scopesFor(area);
  outer: for (const scope of scopes) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (opts.signal.aborted || Date.now() + PAGE_RESERVE_MS > deadline) {
        partial = true;
        notes.push("FR register: stopped early (time budget)");
        break outer;
      }
      const qs = new URLSearchParams({
        activite_principale: category.naf.join(","),
        etat_administratif: "A",
        page: String(page),
        per_page: String(PER_PAGE),
        ...scope,
      });
      const url = `${HOSTS.frRegister}/search?${qs.toString()}`;
      let data: SearchPage;
      try {
        data = await fetchPage(url, opts.signal);
      } catch (e) {
        partial = true;
        notes.push(`FR register: request failed (${e instanceof HttpError ? e.code : "error"})`);
        break outer;
      }
      for (const c of data.results) {
        const etabs = c.matching_etablissements && c.matching_etablissements.length > 0 ? c.matching_etablissements : c.siege ? [c.siege] : [];
        for (const e of etabs) {
          const b = mapEstablishment(c, e, area);
          if (b && !seen.has(b.sourceId)) {
            seen.add(b.sourceId);
            rows.push(b);
          }
        }
      }
      if (data.results.length === 0 || page >= data.total_pages) break;
      if (page === MAX_PAGES && data.total_pages > MAX_PAGES) {
        partial = true;
        notes.push(`FR register: ${JSON.stringify(scope)} has ${data.total_pages} pages, read ${MAX_PAGES}`);
      }
    }
  }
  return { rows, partial, notes };
}

export const frRegisterAdapter: RichAdapter = {
  id: "fr_register",
  enabled: () => true,
  supports: (area) => area.countryCode === "FR",
  searchRich: searchFrRegister,
  async search(area, category, opts) {
    return (await searchFrRegister(area, category, opts)).rows;
  },
};

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
    diffusion: c.statut_diffusion === "diffusible" ? "full" : "partial",
    soleTrader: c.nature_juridique ? c.nature_juridique === SOLE_TRADER_NATURE : null,
    legalForm: c.nature_juridique ?? null,
  };
}
