// Pure rules behind area resolution (docs/finder-ux-spec.md §2.1–2.4): how a
// Nominatim hit is classified into a kind and a country, the ambiguity and
// alternatives rules, the FR region ISO → INSEE table, labels and the circle
// radius for node/way hits. No imports beyond types, so geocode.test.ts runs
// under node --test against fixtures/nominatim-shapes.json.
import type { AreaKind } from "../crm/types.ts";

export type NominatimHit = {
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string]; // [s, n, w, e]
  importance?: number;
  addresstype?: string;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
};

export type OsmType = "relation" | "node" | "way";

export type Classified = {
  osmType: OsmType;
  osmId: number;
  kind: AreaKind;
  countryCode: string;
  countryName: string;
  name: string;
  addresstype: string;
  importance: number;
  lat: number;
  lng: number;
  bbox: [number, number, number, number]; // [s, w, n, e]
  /** French administrative codes when the hit carries them. */
  inseeCode?: string; // commune
  departement?: string; // "09", "2A", "971"
  regionIso?: string; // "FR-OCC"
  regionCode?: string; // "76"
  /** Region / county for labels ("Cambridge, England") */
  state?: string;
  county?: string;
};

export type Candidate = { osmType: OsmType; osmId: number; label: string; kind: AreaKind; countryCode: string; countryName: string };

export const TOWN_TYPES = new Set(["city", "town", "village", "municipality", "hamlet", "suburb", "quarter", "neighbourhood", "borough", "city_district"]);
export const REGION_TYPES = new Set(["state", "region", "province"]);
export const DEPARTMENT_TYPES = new Set(["county", "state_district"]);
export const SMALL_PLACE_TYPES = new Set(["village", "hamlet", "neighbourhood", "quarter", "isolated_dwelling", "locality"]);

/** ISO 3166-2 region code → INSEE region code (18 rows; unit-tested against the names geo.gouv /regions returns). */
export const FR_REGION_ISO_TO_INSEE: Record<string, string> = {
  "FR-OCC": "76",
  "FR-NAQ": "75",
  "FR-ARA": "84",
  "FR-IDF": "11",
  "FR-BFC": "27",
  "FR-BRE": "53",
  "FR-CVL": "24",
  "FR-COR": "94",
  "FR-GES": "44",
  "FR-HDF": "32",
  "FR-NOR": "28",
  "FR-PDL": "52",
  "FR-PAC": "93",
  "FR-GP": "01",
  "FR-MQ": "02",
  "FR-GF": "03",
  "FR-RE": "04",
  "FR-YT": "06",
};

/** Names as geo.api.gouv.fr /regions returns them (12 Sep 2026) — keeps the table honest. */
export const FR_REGION_NAMES: Record<string, string> = {
  "11": "Île-de-France",
  "24": "Centre-Val de Loire",
  "27": "Bourgogne-Franche-Comté",
  "28": "Normandie",
  "32": "Hauts-de-France",
  "44": "Grand Est",
  "52": "Pays de la Loire",
  "53": "Bretagne",
  "75": "Nouvelle-Aquitaine",
  "76": "Occitanie",
  "84": "Auvergne-Rhône-Alpes",
  "93": "Provence-Alpes-Côte d'Azur",
  "94": "Corse",
  "01": "Guadeloupe",
  "02": "Martinique",
  "03": "Guyane",
  "04": "La Réunion",
  "06": "Mayotte",
};

export const DEPARTEMENT_CODE_RE = /^(0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/;
export const INSEE_COMMUNE_RE = /^\d[0-9AB]\d{3}$/;
export const CC_RE = /^[A-Z]{2}$/;
export const AMBIGUITY_RATIO = 0.75;
export const MAX_CANDIDATES = 5;
export const MAX_ALTERNATIVES = 3;

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** English country name for an ISO code ("ES" → "Spain"), else the name the source gave. */
export function countryNameOf(cc: string, fallback?: string): string {
  if (CC_RE.test(cc) && cc !== "XX") {
    try {
      const n = displayNames?.of(cc);
      if (n && n !== cc) return n;
    } catch {
      // unknown code → fallback
    }
  }
  return (fallback ?? "").trim() || cc;
}

/** "FR-09" → "09", "FR-2A" → "2A", "FR-971" → "971"; null for anything else. */
export function departementFromIso(iso: string | undefined): string | null {
  const m = /^FR-(\d{2,3}|2[AB])$/.exec(iso ?? "");
  return m && DEPARTEMENT_CODE_RE.test(m[1]!) ? m[1]! : null;
}

/** FR-OCC → 76 through the table; falls back to a 2-digit ref:INSEE extratag. */
export function regionCodeOf(iso: string | undefined, refInsee: string | undefined): string | null {
  if (iso && FR_REGION_ISO_TO_INSEE[iso]) return FR_REGION_ISO_TO_INSEE[iso]!;
  return refInsee && /^\d{2}$/.test(refInsee) ? refInsee : null;
}

function osmTypeOf(h: NominatimHit): OsmType | null {
  return h.osm_type === "relation" || h.osm_type === "node" || h.osm_type === "way" ? h.osm_type : null;
}

/** Kind from the address block and extratags (§2.2). */
export function kindOf(h: NominatimHit, osmType: OsmType): AreaKind {
  const t = h.addresstype ?? "";
  const a = h.address ?? {};
  const x = h.extratags ?? {};
  const isRel = osmType === "relation";
  if (t === "country" || (isRel && x.admin_level === "2")) return "country";
  if (REGION_TYPES.has(t) || (isRel && !!a["ISO3166-2-lvl4"] && a["ISO3166-2-lvl4"] === x["ISO3166-2"])) return "region";
  if (DEPARTMENT_TYPES.has(t) || (isRel && !!a["ISO3166-2-lvl6"] && a["ISO3166-2-lvl6"] === x["ISO3166-2"])) return "department";
  if (t === "postcode") return "postcode";
  if (TOWN_TYPES.has(t) && isRel) return "town";
  return "place";
}

/** Classify one search hit; null when it has no OSM identity or coordinates (postcode pseudo-hits, junk). */
export function classifyHit(h: NominatimHit): Classified | null {
  const osmType = osmTypeOf(h);
  const osmId = Number(h.osm_id);
  const lat = Number(h.lat);
  const lng = Number(h.lon);
  const [s, n, w, e] = (h.boundingbox ?? []).map(Number);
  if (!osmType || !Number.isInteger(osmId) || osmId <= 0 || ![lat, lng].every(Number.isFinite)) return null;
  const a = h.address ?? {};
  const x = h.extratags ?? {};
  const cc = (a.country_code ?? "").toUpperCase();
  const kind = kindOf(h, osmType);
  const name = (h.name || (h.display_name ?? "").split(", ")[0] || "").trim();
  if (!name) return null;
  const countryCode = CC_RE.test(cc) ? cc : "XX";
  const bbox: [number, number, number, number] = [s, n, w, e].every(Number.isFinite) ? [s!, w!, n!, e!] : [lat - 0.02, lng - 0.03, lat + 0.02, lng + 0.03];
  const out: Classified = {
    osmType,
    osmId,
    kind,
    countryCode,
    countryName: countryNameOf(countryCode, a.country),
    name,
    addresstype: h.addresstype ?? h.type ?? "",
    importance: Number.isFinite(Number(h.importance)) ? Number(h.importance) : 0,
    lat,
    lng,
    bbox,
    state: a.state?.trim() || undefined,
    county: a.county?.trim() || undefined,
  };
  if (out.countryCode === "FR") {
    const ref = (x["ref:INSEE"] ?? "").trim();
    if (kind === "department") out.departement = (DEPARTEMENT_CODE_RE.test(ref) ? ref : null) ?? departementFromIso(a["ISO3166-2-lvl6"]) ?? undefined;
    else if (kind === "region") {
      out.regionIso = a["ISO3166-2-lvl4"] || undefined;
      out.regionCode = regionCodeOf(a["ISO3166-2-lvl4"], ref) ?? undefined;
    } else if (kind === "town" || kind === "place") {
      if (INSEE_COMMUNE_RE.test(ref)) out.inseeCode = ref;
      out.departement = departementFromIso(a["ISO3166-2-lvl6"]) ?? undefined;
    }
  }
  return out;
}

/** "department" / "region" / "country" / "city" / "mountain range" … for chooser lines. */
export function kindWord(c: Pick<Classified, "kind" | "addresstype">): string {
  if (c.kind === "department") return "department";
  if (c.kind === "region") return "region";
  if (c.kind === "country") return "country";
  if (c.kind === "postcode") return "postcode";
  const t = (c.addresstype || "place").replace(/_/g, " ");
  return t;
}

/** "Cambridge — city, United Kingdom"; `where` adds the county/state to tell same-country duplicates apart. */
export function candidateLabel(c: Classified, where = false): string {
  const parts = [kindWord(c)];
  if (where && (c.county || c.state)) parts.push(c.county ?? c.state!);
  if (c.countryName) parts.push(c.countryName);
  return `${c.name} — ${parts.join(", ")}`;
}

/** The area's label: the name, plus ", <state>" for towns and places outside France. */
export function areaLabel(c: Pick<Classified, "name" | "kind" | "countryCode" | "state">): string {
  if ((c.kind === "town" || c.kind === "place") && c.countryCode !== "FR" && c.state && c.state !== c.name) return `${c.name}, ${c.state}`;
  return c.name;
}

function toCandidate(c: Classified, where: boolean): Candidate {
  return { osmType: c.osmType, osmId: c.osmId, label: candidateLabel(c, where), kind: c.kind, countryCode: c.countryCode, countryName: c.countryName };
}

/** Labels made unique by adding the county/state where two candidates would otherwise read the same. */
function labelled(list: Classified[]): Candidate[] {
  const plain = list.map((c) => candidateLabel(c));
  return list.map((c, i) => toCandidate(c, plain.filter((l) => l === plain[i]).length > 1));
}

/**
 * The place node of a town duplicates its boundary relation in Nominatim's
 * results: keep the relation, drop the node/way with the same name + country.
 */
export function collapseDuplicates(list: Classified[]): Classified[] {
  const out: Classified[] = [];
  for (const c of list) {
    const twin = out.find((o) => o.name === c.name && o.countryCode === c.countryCode && (o.osmType === "relation") !== (c.osmType === "relation"));
    if (twin) {
      if (c.osmType === "relation") out[out.indexOf(twin)] = c;
      continue;
    }
    if (out.some((o) => o.osmType === c.osmType && o.osmId === c.osmId)) continue;
    out.push(c);
  }
  return out;
}

export type Choice = { ambiguous: true; candidates: Candidate[] } | { ambiguous: false; chosen: Classified; alternatives: Candidate[] };

/**
 * Ambiguity rule (§2.3): among the hits keep those with importance ≥ 0.75 ×
 * the first hit's; if they span more than one country or kind the caller
 * shows a chooser, else the first hit wins and the others come back as
 * non-blocking alternatives (≤ 3, unique labels).
 */
export function chooseHit(hits: NominatimHit[]): Choice | null {
  const all = collapseDuplicates(hits.map(classifyHit).filter((c): c is Classified => c !== null));
  if (all.length === 0) return null;
  const top = all[0]!;
  const kept = all.filter((c) => c.importance >= AMBIGUITY_RATIO * top.importance);
  const countries = new Set(kept.map((c) => c.countryCode));
  const kinds = new Set(kept.map((c) => c.kind));
  if (kept.length > 1 && (countries.size > 1 || kinds.size > 1)) return { ambiguous: true, candidates: labelled(kept.slice(0, MAX_CANDIDATES)) };
  const rest = all.filter((c) => c !== top);
  const labels = labelled([top, ...rest]);
  const seen = new Set<string>([labels[0]!.label]);
  const alternatives: Candidate[] = [];
  for (const cand of labels.slice(1)) {
    if (seen.has(cand.label)) continue;
    seen.add(cand.label);
    alternatives.push(cand);
    if (alternatives.length >= MAX_ALTERNATIVES) break;
  }
  return { ambiguous: false, chosen: top, alternatives };
}

/** Radius for node/way hits: 1.5 km for villages, hamlets and neighbourhoods; 4 km for towns, suburbs and anything else. */
export function circleKmFor(addresstype: string): number {
  return SMALL_PLACE_TYPES.has(addresstype) ? 1.5 : 4;
}

/**
 * Display polygon threshold (§2.4): 0.01 for a country, 0.005 for departments
 * and regions; towns get 0.0005 (at 0.005 Foix is a 12-point wedge, not the
 * town — and 0.0005 is the fine polygon's threshold, so the same cached
 * lookup serves both) and other places 0.001.
 */
export function displayThreshold(kind: AreaKind): number {
  if (kind === "country") return 0.01;
  if (kind === "town") return 0.0005;
  if (kind === "place") return 0.001;
  return 0.005;
}

/** Only towns, departments and places get the fine polygon (§2.4). */
export function wantsFinePolygon(kind: AreaKind): boolean {
  return kind === "town" || kind === "department" || kind === "place";
}

/** "Foix (09000)" for one commune, "09120 — Varilhes and 16 more communes" for several (main = most populous). */
export function postcodeLabel(code: string, communes: { nom: string; population?: number }[]): string {
  if (communes.length === 0) return code;
  const main = [...communes].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0]!;
  if (communes.length === 1) return `${main.nom} (${code})`;
  const others = communes.length - 1;
  return `${code} — ${main.nom} and ${others} more commune${others === 1 ? "" : "s"}`;
}
