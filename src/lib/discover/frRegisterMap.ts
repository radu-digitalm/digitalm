// Pure mapping for the API Recherche d'entreprises adapter (contract §6
// "fr_register"): what we keep of a company and an establishment, and the
// Business a row becomes. No network, no DB, relative imports only, so the
// "dirigeants / finances never leave the adapter" promise is unit-tested.
import type { Area, Business } from "../crm/types.ts";

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
