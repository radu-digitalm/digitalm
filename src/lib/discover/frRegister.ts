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
import type { AdapterResult, RichAdapter } from "./index";

const GAP_MS = 200; // 5 req/s
const PER_PAGE = 25;
const MAX_PAGES = 10;
const MAX_RADIUS_KM = 50;
const PAGE_RESERVE_MS = 1_500;

export const SIRET_RE = /^\d{14}$/;
export const SOLE_TRADER_NATURE = "1000"; // entrepreneur individuel

/** What we keep of an establishment (matching_etablissements[] / siege). */
type SlimEtab = {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  liste_enseignes?: string[] | null;
  etat_administratif?: string;
};

/** What we keep of a company (unité légale). */
type SlimCompany = {
  nom_complet?: string;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  siren?: string;
  nature_juridique?: string | null;
  activite_principale?: string | null;
  etat_administratif?: string;
  statut_diffusion?: string;
  siege?: SlimEtab | null;
  matching_etablissements?: SlimEtab[];
};

type SearchPage = { results: SlimCompany[]; total_results: number; total_pages: number; page: number };

function slimEtab(e: unknown): SlimEtab | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    siret: str("siret"),
    adresse: str("adresse"),
    code_postal: str("code_postal"),
    libelle_commune: str("libelle_commune"),
    latitude: typeof o.latitude === "string" || typeof o.latitude === "number" ? o.latitude : null,
    longitude: typeof o.longitude === "string" || typeof o.longitude === "number" ? o.longitude : null,
    liste_enseignes: Array.isArray(o.liste_enseignes) ? o.liste_enseignes.filter((x): x is string => typeof x === "string") : null,
    etat_administratif: str("etat_administratif"),
  };
}

/**
 * Keep the contract's field list and nothing else — `dirigeants`, `finances`,
 * `complements`, `collectivite_territoriale` and any other block are dropped
 * by construction (we copy known keys rather than delete unknown ones).
 */
export function slimCompany(c: unknown): SlimCompany | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    nom_complet: str("nom_complet"),
    nom_raison_sociale: str("nom_raison_sociale") ?? null,
    sigle: str("sigle") ?? null,
    siren: str("siren"),
    nature_juridique: str("nature_juridique") ?? null,
    activite_principale: str("activite_principale") ?? null,
    etat_administratif: str("etat_administratif"),
    statut_diffusion: str("statut_diffusion"),
    siege: slimEtab(o.siege),
    matching_etablissements: Array.isArray(o.matching_etablissements)
      ? o.matching_etablissements.map(slimEtab).filter((x): x is SlimEtab => x !== null)
      : [],
  };
}

function num(v: string | number | null | undefined): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function tidy(s: string | null | undefined, max = 120): string | undefined {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

/** One establishment of a company → Business. Null for closed establishments or missing SIRET. */
export function mapEstablishment(c: SlimCompany, e: SlimEtab, area: Area): Business | null {
  if (!e.siret || !SIRET_RE.test(e.siret)) return null;
  if (e.etat_administratif && e.etat_administratif !== "A") return null;
  const enseigne = tidy(e.liste_enseignes?.[0]);
  const legalName = tidy(c.nom_raison_sociale) ?? tidy(c.nom_complet);
  const name = enseigne ?? tidy(c.nom_complet) ?? legalName;
  if (!name) return null;
  const lat = num(e.latitude);
  const lng = num(e.longitude);
  const hasGeo = lat !== undefined && lng !== undefined;
  return {
    source: "fr_register",
    sourceId: e.siret,
    sourceUrl: `https://annuaire-entreprises.data.gouv.fr/etablissement/${e.siret}`,
    name,
    legalName,
    enseigne,
    addressLine: tidy(e.adresse, 200),
    postcode: tidy(e.code_postal, 12),
    city: tidy(e.libelle_commune, 80),
    countryCode: "FR",
    lat: hasGeo ? lat : area.center.lat,
    lng: hasGeo ? lng : area.center.lng,
    geoSource: hasGeo ? "source" : "centre",
    registerId: e.siret,
    legalForm: c.nature_juridique ?? undefined,
    soleTrader: c.nature_juridique === SOLE_TRADER_NATURE,
    diffusion: c.statut_diffusion === "diffusible" ? "full" : "partial",
    active: c.etat_administratif === "A",
  };
}

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
