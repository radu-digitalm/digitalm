// Pure mapping for the API Recherche d'entreprises adapter (contract §6
// "fr_register"): what we keep of a company and an establishment, and the
// Business a row becomes. No network, no DB, relative imports only, so the
// "dirigeants / finances never leave the adapter" promise is unit-tested.
import type { Area, Business, ResolvedArea } from "../crm/types.ts";

export const SIRET_RE = /^\d{14}$/;
export const SOLE_TRADER_NATURE = "1000"; // entrepreneur individuel

/** What we keep of an establishment (matching_etablissements[] / siege). */
export type SlimEtab = {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  liste_enseignes?: string[] | null;
  etat_administratif?: string;
  statut_diffusion_etablissement?: string;
};

/** What we keep of a company (unité légale). */
export type SlimCompany = {
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

export function slimEtab(e: unknown): SlimEtab | null {
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
    statut_diffusion_etablissement: str("statut_diffusion_etablissement"),
  };
}

/** The codes that mean "listed publicly": the live API answers "O" (ouvert); older answers spelled it out. */
const FULL_DIFFUSION = new Set(["O", "diffusible"]);

/**
 * statut_diffusion → our two states. "O" (and the legacy "diffusible") is
 * public; "P" / "partiellement_diffusible" / "N" and anything unknown mean
 * the owner asked the register to hide the details. The establishment's own
 * status counts when the API gives one; a hidden company hides its shops.
 */
export function diffusionOf(company: string | null | undefined, establishment?: string | null): "full" | "partial" {
  const c = company?.trim() ?? "";
  const e = establishment?.trim() ?? "";
  if (e) return FULL_DIFFUSION.has(e) && (!c || FULL_DIFFUSION.has(c)) ? "full" : "partial";
  return FULL_DIFFUSION.has(c) ? "full" : "partial";
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
    diffusion: diffusionOf(c.statut_diffusion, e.statut_diffusion_etablissement),
    active: c.etat_administratif === "A",
  };
}

// ---- register scopes (docs/finder-ux-spec.md §3.4) ----------------------------------------

export const MAX_SCOPE_POSTCODES = 12;
export const MAX_RADIUS_KM = 50;
export const POSTCODE_RE = /^\d{5}$/;
export const DEPARTEMENT_RE = /^(0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/;

export type RegisterScopeSpec = {
  id: string; // "cp:09000" | "dep:09" | "near:42.96,1.61"
  label: string; // "09000" | "Ariège (09)" | "within 12 km of Foix"
  mode: "postcode" | "departement" | "near_point";
  params: Record<string, string>; // query-string fields for the register API
};

type ScopeArea = Pick<ResolvedArea, "kind" | "countryCode" | "label" | "center" | "radiusKm"> & { admin?: ResolvedArea["admin"] };

function depLabel(code: string, names: Record<string, string>): string {
  const name = names[code];
  return name ? `${name} (${code})` : `Department ${code}`;
}

function nearPoint(area: ScopeArea): RegisterScopeSpec {
  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Math.ceil(area.radiusKm || 1)));
  return {
    id: `near:${area.center.lat.toFixed(2)},${area.center.lng.toFixed(2)}`,
    label: `within ${radius} km of ${area.label}`,
    mode: "near_point",
    params: { lat: area.center.lat.toFixed(5), long: area.center.lng.toFixed(5), radius: String(radius) },
  };
}

function postcodeScopes(postcodes: readonly string[]): RegisterScopeSpec[] {
  return [...new Set(postcodes.filter((p) => POSTCODE_RE.test(p)))].slice(0, MAX_SCOPE_POSTCODES).map((code_postal) => ({ id: `cp:${code_postal}`, label: code_postal, mode: "postcode", params: { code_postal } }));
}

/**
 * Which register queries an area needs (§3.4): postcodes for a postcode /
 * town with geo.gouv data, the department for a department, one department
 * per OpenStreetMap unit that ran for regions and France (all of them when
 * the area was a single unit), a radius for places and towns without codes.
 * Non-FR areas get none. `ranUnits` are the units in run order whose state
 * is `done`; `names` maps department codes to names for the labels.
 */
export function scopesFor(area: ScopeArea, ranUnits: readonly { code?: string; label?: string }[], names: Record<string, string> = {}, singleUnit = ranUnits.length <= 1): RegisterScopeSpec[] {
  if (area.countryCode !== "FR") return [];
  const admin = area.admin ?? {};
  const postcodes = admin.postcodes ?? [];
  if (area.kind === "postcode") {
    const s = postcodeScopes(postcodes);
    return s.length > 0 ? s : [nearPoint(area)];
  }
  if (area.kind === "town") {
    const s = postcodes.length > 0 && postcodes.length <= MAX_SCOPE_POSTCODES ? postcodeScopes(postcodes) : [];
    return s.length > 0 ? s : [nearPoint(area)];
  }
  if (area.kind === "department") {
    const code = admin.departement;
    return code && DEPARTEMENT_RE.test(code) ? [{ id: `dep:${code}`, label: depLabel(code, { ...names, [code]: names[code] ?? area.label }), mode: "departement", params: { departement: code } }] : [nearPoint(area)];
  }
  if (area.kind === "region" || area.kind === "country") {
    const known = (admin.departements ?? []).filter((c) => DEPARTEMENT_RE.test(c));
    const unitNames: Record<string, string> = { ...names };
    for (const u of ranUnits) if (u.code && u.label && DEPARTEMENT_RE.test(u.code) && !unitNames[u.code]) unitNames[u.code] = u.label;
    let codes: string[];
    if (singleUnit) codes = known;
    else {
      const ran = ranUnits.map((u) => u.code ?? "").filter((c) => DEPARTEMENT_RE.test(c));
      codes = known.length > 0 ? ran.filter((c) => known.includes(c)) : ran;
    }
    return [...new Set(codes)].map((code) => ({ id: `dep:${code}`, label: depLabel(code, unitNames), mode: "departement", params: { departement: code } }));
  }
  return [nearPoint(area)];
}

/**
 * Where a register row lands (§3.4): rows with source coordinates are kept
 * only inside the polygon; rows without coordinates sit at the area centre
 * as "approx" under an administrative scope and are dropped under near_point.
 */
export function placeRegisterRow(
  b: Pick<Business, "lat" | "lng" | "geoSource">,
  mode: RegisterScopeSpec["mode"],
  inside: (lng: number, lat: number) => boolean,
): { keep: boolean; inside: "yes" | "approx" | "no" } {
  if (b.geoSource === "source" && typeof b.lat === "number" && typeof b.lng === "number") {
    return inside(b.lng, b.lat) ? { keep: true, inside: "yes" } : { keep: false, inside: "no" };
  }
  return mode === "near_point" ? { keep: false, inside: "no" } : { keep: true, inside: "approx" };
}
