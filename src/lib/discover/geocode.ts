// Area resolution (docs/finder-ux-spec.md §2): any place OpenStreetMap knows
// — a town, a postcode, a department, a region, a country — becomes a
// ResolvedArea with a kind, a country, an Overpass area selector and the
// display outline. French postcodes and department codes go through
// geo.api.gouv.fr; everything else through Nominatim in two steps (a search
// without polygons, then a lookup with the polygon of the chosen hit).
// Nominatim: identifying User-Agent, ≥ 1100 ms between calls, never in
// parallel, 30-day cache, area-level lookups only — never one per business.
import { DAY_MS, cacheGet, cacheSet, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { AreaKind, AreaSelector, GeoPolygon, ResolvedArea } from "@/lib/crm/types";
import {
  CC_RE,
  DEPARTEMENT_CODE_RE,
  INSEE_COMMUNE_RE,
  areaLabel,
  chooseHit,
  circleKmFor,
  classifyHit,
  countryNameOf,
  displayThreshold,
  postcodeLabel,
  wantsFinePolygon,
  type Candidate,
  type Classified,
  type NominatimHit,
  type OsmType,
} from "./geocodeRules";
import { bboxOf, bboxRadiusKm, circlePolygon, isGeoPolygon, pointCount, roundPolygon, simplifyPolygon, type Bbox } from "./polygon";

/** Error with a stable code the API routes map to a status (404 / 409 / 400 / 502) and an optional detail object. */
export class DiscoverError extends Error {
  code: string;
  status: number;
  detail?: Record<string, unknown>;
  constructor(code: string, status = 422, message = code, detail?: Record<string, unknown>) {
    super(message);
    this.name = "DiscoverError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type { Candidate } from "./geocodeRules";
export type AreaPick = { osmType: OsmType; osmId: number };
export type Resolution = { area: ResolvedArea; alternatives: Candidate[] };

const GEO_CACHE_MS = 30 * DAY_MS;
const NOMINATIM_GAP_MS = 1100;
const GEO_GOUV_GAP_MS = 200;
export const DISPLAY_MAX_POINTS = 5_000;
export const FINE_MAX_POINTS = 50_000;
export const FINE_THRESHOLD = 0.0005;
const POSTCODE_RE = /^\d{5}$/;
const GEO_GOUV_MAX_BYTES = 2_000_000;

// ---- geo.api.gouv.fr ---------------------------------------------------------------

type GeoPoint = { type: "Point"; coordinates: [number, number] };
export type GeoCommune = {
  nom: string;
  code: string;
  codeDepartement?: string;
  codesPostaux?: string[];
  centre?: GeoPoint;
  contour?: { type: string; coordinates: unknown };
  population?: number;
};

/** GET a geo.gouv path, cached 30 d; payloads over 2 MB are refused (HttpError too_large). */
export async function geoGouv<T>(path: string, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const url = `${HOSTS.geoGouv}${path}`;
  const { value, hit } = await cached<{ data: T }>("geo_gouv", { url }, GEO_CACHE_MS, async () => {
    const res = await spaced("geo_gouv", GEO_GOUV_GAP_MS, () => fetchJson<T>(url, { timeoutMs: 15_000, signal: opts.signal }));
    if (JSON.stringify(res.data).length > GEO_GOUV_MAX_BYTES) throw new HttpError("too_large", res.status);
    return { data: res.data };
  });
  if (!hit) countApiUsage("geo_gouv");
  return value.data;
}

async function geoGouvOr404<T>(path: string): Promise<T | null> {
  try {
    return await geoGouv<T>(path);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** Every French department code with its name (cached 30 d). */
export async function frDepartements(): Promise<{ code: string; nom: string }[]> {
  const list = await geoGouv<{ code: string; nom: string }[]>("/departements");
  return (Array.isArray(list) ? list : []).filter((d) => DEPARTEMENT_CODE_RE.test(d.code));
}

/** Every French region with its INSEE code and name (cached 30 d) — the gate's chips for "France". */
export async function frRegions(): Promise<{ code: string; nom: string }[]> {
  const list = await geoGouv<{ code: string; nom: string }[]>("/regions");
  return (Array.isArray(list) ? list : []).filter((r) => r && /^\d{2}$/.test(r.code) && typeof r.nom === "string" && r.nom.trim() !== "");
}

/** The departments of an INSEE region code (cached 30 d). */
export async function frRegionDepartements(regionCode: string): Promise<{ code: string; nom: string }[]> {
  if (!/^\d{2}$/.test(regionCode)) return [];
  const list = await geoGouvOr404<{ code: string; nom: string }[]>(`/regions/${regionCode}/departements`);
  return (Array.isArray(list) ? list : []).filter((d) => DEPARTEMENT_CODE_RE.test(d.code));
}

function unionOfContours(communes: GeoCommune[]): GeoPolygon | null {
  const polys: unknown[] = [];
  for (const c of communes) {
    const g = c.contour;
    if (!g || !Array.isArray(g.coordinates)) continue;
    if (g.type === "Polygon") polys.push(g.coordinates);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates as unknown[]) polys.push(p);
  }
  if (polys.length === 0) return null;
  const geom: GeoPolygon = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  return isGeoPolygon(geom) ? geom : null;
}

/** A French postcode → every commune of the postcode; the outline is the exact union of their contours. */
async function postcodeArea(code: string): Promise<ResolvedArea | null> {
  const qs = new URLSearchParams({ codePostal: code, fields: "nom,code,codeDepartement,codesPostaux,centre,contour,population" });
  const list = await geoGouv<GeoCommune[]>(`/communes?${qs.toString()}`);
  const communes = (Array.isArray(list) ? list : []).filter((c) => c && typeof c.code === "string" && INSEE_COMMUNE_RE.test(c.code) && c.centre?.coordinates);
  if (communes.length === 0) return null;
  const main = [...communes].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0]!;
  const [lng, lat] = main.centre!.coordinates;
  const exact = unionOfContours(communes);
  // The exact union is what the register rows are tested against (finePolygon); the outline sent to the map is thinned.
  if (exact) cacheSet(postcodeExactKey(code), "geo_gouv", roundPolygon(exact, 6), GEO_CACHE_MS);
  const polygon = exact ? roundPolygon(simplifyPolygon(exact, DISPLAY_MAX_POINTS), 5) : null;
  const bbox: Bbox = (exact ? bboxOf(exact) : null) ?? [lat - 0.03, lng - 0.04, lat + 0.03, lng + 0.04];
  const center = { lat, lng };
  const postcodes = [...new Set(communes.flatMap((c) => c.codesPostaux ?? []))].filter((p) => POSTCODE_RE.test(p)).sort();
  return {
    label: postcodeLabel(code, communes),
    countryCode: "FR",
    countryName: "France",
    kind: "postcode",
    center,
    bbox,
    polygon,
    ...(polygon ? {} : { polygonApprox: true }),
    areaSelector: { kind: "insee", codes: communes.map((c) => c.code) },
    admin: {
      postcodes: [code, ...postcodes.filter((p) => p !== code)],
      inseeCode: main.code,
      inseeCodes: communes.map((c) => c.code),
      departement: main.codeDepartement ?? main.code.slice(0, 2),
      locality: main.nom,
    },
    radiusKm: bboxRadiusKm(center, bbox),
    provider: "geo_gouv",
  };
}

function postcodeExactKey(code: string): string {
  return `postcode_exact:${code}`;
}

// ---- Nominatim ------------------------------------------------------------------------

const EXTRA_KEYS = ["ref:INSEE", "ISO3166-2", "ISO3166-1", "admin_level", "place"] as const;

type LookupHit = NominatimHit & { geojson?: unknown };

/** Only what classification needs — no raw payload lingers in the cache. */
function slimHit(h: LookupHit, withGeo = false): LookupHit {
  const extratags: Record<string, string> = {};
  for (const k of EXTRA_KEYS) if (typeof h.extratags?.[k] === "string") extratags[k] = h.extratags[k]!;
  const out: LookupHit = {
    osm_type: h.osm_type,
    osm_id: h.osm_id,
    lat: h.lat,
    lon: h.lon,
    boundingbox: h.boundingbox,
    importance: h.importance,
    addresstype: h.addresstype,
    category: h.category,
    type: h.type,
    name: h.name,
    display_name: h.display_name,
    address: h.address,
    extratags,
  };
  if (withGeo && h.geojson) out.geojson = h.geojson;
  return out;
}

/** `search` without polygons, five hits, cached 30 d. */
export async function nominatimSearch(q: string): Promise<NominatimHit[]> {
  const qs = new URLSearchParams({ q, format: "jsonv2", limit: "5", addressdetails: "1", extratags: "1" });
  const url = `${HOSTS.nominatim}/search?${qs.toString()}`;
  const { value, hit } = await cached<{ hits: NominatimHit[] }>("nominatim", { url }, GEO_CACHE_MS, async () => {
    const res = await spaced("nominatim", NOMINATIM_GAP_MS, () => fetchJson<LookupHit[]>(url, { timeoutMs: 15_000 }));
    return { hits: (Array.isArray(res.data) ? res.data : []).map((h) => slimHit(h)) };
  });
  if (!hit) countApiUsage("nominatim");
  return value.hits;
}

/** `lookup` of one OSM object with its polygon at a threshold, cached 30 d per (id, threshold). */
export async function nominatimLookup(osmType: OsmType, osmId: number, threshold: number | null): Promise<LookupHit | null> {
  const id = `${osmType[0]!.toUpperCase()}${osmId}`;
  const qs = new URLSearchParams({ osm_ids: id, format: "jsonv2", addressdetails: "1", extratags: "1" });
  if (threshold !== null) {
    qs.set("polygon_geojson", "1");
    qs.set("polygon_threshold", String(threshold));
  }
  const url = `${HOSTS.nominatim}/lookup?${qs.toString()}`;
  const { value, hit } = await cached<{ hit: LookupHit | null }>("nominatim", { url }, GEO_CACHE_MS, async () => {
    const res = await spaced("nominatim", NOMINATIM_GAP_MS, () => fetchJson<LookupHit[]>(url, { timeoutMs: 30_000 }));
    const first = Array.isArray(res.data) ? res.data[0] : undefined;
    return { hit: first ? slimHit(first, threshold !== null) : null };
  });
  if (!hit) countApiUsage("nominatim");
  return value.hit;
}

/**
 * The display outline (§2.4): the lookup polygon at the kind's threshold,
 * capped at 5,000 points — over the cap, re-requested at double the
 * threshold, up to three times. Returns the last hit and its polygon.
 */
async function lookupWithOutline(pick: AreaPick, kind: AreaKind, maxPoints = DISPLAY_MAX_POINTS, startThreshold = displayThreshold(kind)): Promise<{ hit: LookupHit; polygon: GeoPolygon | null }> {
  let threshold = startThreshold;
  let last: LookupHit | null = null;
  for (let i = 0; i < 4; i++) {
    const h = await nominatimLookup(pick.osmType, pick.osmId, threshold);
    if (!h) throw new DiscoverError("area_not_found", 404, "That place could not be looked up");
    last = h;
    if (isGeoPolygon(h.geojson)) {
      if (pointCount(h.geojson) <= maxPoints) return { hit: h, polygon: roundPolygon(h.geojson, 5) };
    } else {
      return { hit: h, polygon: null };
    }
    threshold *= 2;
  }
  return { hit: last!, polygon: null };
}

function circleFor(c: Classified): { polygon: GeoPolygon; km: number } {
  const km = circleKmFor(c.addresstype);
  return { polygon: circlePolygon(c.lat, c.lng, km), km };
}

/** Build the ResolvedArea of a chosen hit: outline, selector, admin data, label. */
async function areaFromPick(pick: AreaPick, hint: Classified | null): Promise<ResolvedArea> {
  const kindHint: AreaKind = hint?.kind ?? "place";
  const { hit, polygon: found } = await lookupWithOutline(pick, kindHint);
  const c = classifyHit({ ...hit, osm_type: pick.osmType, osm_id: pick.osmId });
  if (!c) throw new DiscoverError("area_not_found", 404, "That place could not be used");
  const center = { lat: c.lat, lng: c.lng };
  let polygon: GeoPolygon | null = found;
  let polygonApprox: boolean | undefined;
  let selector: AreaSelector;
  let label = areaLabel(c);
  let kind = c.kind;
  if (c.osmType === "relation" && polygon) {
    selector = { kind: "relation", relId: c.osmId };
  } else {
    // Nodes, ways and relations without a usable outline: a circle around the point.
    const circle = circleFor(c);
    polygon = circle.polygon;
    polygonApprox = true;
    selector = { kind: "around", lat: c.lat, lng: c.lng, m: Math.round(circle.km * 1000) };
    label = `within ${circle.km} km of ${areaLabel(c)}`;
    if (kind === "town" || kind === "region" || kind === "department" || kind === "country") kind = "place";
  }
  const bbox: Bbox = (polygon ? bboxOf(polygon) : null) ?? c.bbox;
  const area: ResolvedArea = {
    label,
    countryCode: c.countryCode,
    countryName: c.countryName,
    kind,
    center,
    bbox,
    polygon,
    ...(polygonApprox ? { polygonApprox } : {}),
    ...(c.osmType === "relation" ? { osmRelationId: c.osmId } : {}),
    areaSelector: selector,
    radiusKm: bboxRadiusKm(center, bbox),
    provider: "nominatim",
  };
  const admin: NonNullable<ResolvedArea["admin"]> = {};
  if (c.countryCode === "FR") {
    if (kind === "department" && c.departement) admin.departement = c.departement;
    if (kind === "region" && c.regionCode) {
      admin.regionCode = c.regionCode;
      admin.departements = (await frRegionDepartements(c.regionCode)).map((d) => d.code);
    }
    if (kind === "country") admin.departements = (await frDepartements()).map((d) => d.code);
    if ((kind === "town" || kind === "place") && c.inseeCode) {
      const commune = await geoGouvOr404<{ nom: string; codesPostaux?: string[]; codeDepartement?: string }>(`/communes/${c.inseeCode}?fields=nom,codesPostaux,codeDepartement`);
      if (commune) {
        admin.inseeCode = c.inseeCode;
        admin.postcodes = (commune.codesPostaux ?? []).filter((p) => POSTCODE_RE.test(p));
        admin.departement = commune.codeDepartement ?? c.departement;
        admin.locality = commune.nom;
      }
    }
    if (!admin.departement && c.departement && (kind === "town" || kind === "place")) admin.departement = c.departement;
  }
  if (kind === "town" || kind === "place") admin.locality = admin.locality ?? c.name;
  if (Object.keys(admin).length > 0) area.admin = admin;
  return area;
}

function isAbort(e: unknown): boolean {
  return e instanceof HttpError && e.code === "aborted";
}

/**
 * Resolve free text (§2.1). Throws DiscoverError: `area_not_found` (404),
 * `ambiguous` (409, detail.candidates), `bad_area` (400), `geocode_failed` (502).
 * `pick` re-resolves a chooser or alternative choice through `lookup`.
 */
export async function resolveArea(query: string, pick?: AreaPick): Promise<Resolution> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!q && !pick) throw new DiscoverError("area_not_found", 404, "Type a town, a postcode, a department, a region or a country");
  try {
    if (pick) {
      if (!["relation", "node", "way"].includes(pick.osmType) || !Number.isInteger(pick.osmId) || pick.osmId <= 0) throw new DiscoverError("bad_area", 400, "That place could not be used");
      // The kind hint comes from the (cached) search the pick was chosen from; a miss just means a 0.005 outline first.
      const hits = q ? await nominatimSearch(q).catch(() => [] as NominatimHit[]) : [];
      const hint = hits.map(classifyHit).find((c) => c && c.osmType === pick.osmType && c.osmId === pick.osmId) ?? null;
      return { area: await areaFromPick(pick, hint), alternatives: [] };
    }
    if (POSTCODE_RE.test(q)) {
      const area = await postcodeArea(q);
      if (!area) throw new DiscoverError("area_not_found", 404, `No French postcode "${q}"`);
      return { area, alternatives: [] };
    }
    if (DEPARTEMENT_CODE_RE.test(q.toUpperCase())) {
      const dep = await geoGouvOr404<{ nom: string; code: string }>(`/departements/${encodeURIComponent(q.toUpperCase())}`);
      if (!dep) throw new DiscoverError("area_not_found", 404, `No French department "${q}"`);
      const hits = await nominatimSearch(`${dep.nom}, France`);
      const classified = hits.map(classifyHit).filter((c): c is Classified => c !== null);
      const match = classified.find((c) => c.kind === "department" && c.departement === dep.code) ?? classified.find((c) => c.kind === "department") ?? classified[0];
      if (!match) throw new DiscoverError("area_not_found", 404, `No area found for "${q}"`);
      const area = await areaFromPick({ osmType: match.osmType, osmId: match.osmId }, match);
      if (area.kind === "department" && !area.admin?.departement) area.admin = { ...area.admin, departement: dep.code };
      return { area, alternatives: [] };
    }
    const hits = await nominatimSearch(q);
    const choice = chooseHit(hits);
    if (!choice) throw new DiscoverError("area_not_found", 404, `No area found for "${q}"`);
    if (choice.ambiguous) throw new DiscoverError("ambiguous", 409, "Several places match — pick one", { candidates: choice.candidates });
    const area = await areaFromPick({ osmType: choice.chosen.osmType, osmId: choice.chosen.osmId }, choice.chosen);
    return { area, alternatives: choice.alternatives };
  } catch (e) {
    if (e instanceof DiscoverError) throw e;
    if (isAbort(e)) throw e;
    const code = e instanceof HttpError ? e.code : "network";
    throw new DiscoverError("geocode_failed", 502, `The place lookup did not answer (${code})`);
  }
}

/**
 * The fine polygon (§2.4): threshold 0.0005, capped at 50,000 points, only
 * for towns, departments and places with a relation selector; null means
 * "use the display outline". Cached 30 d under its own lookup key.
 */
export async function finePolygon(area: ResolvedArea): Promise<GeoPolygon | null> {
  if (area.kind === "postcode") {
    // Postcodes: the exact union of geo.gouv contours kept at resolution time (re-fetched when the cache has gone).
    const code = area.admin?.postcodes?.[0];
    if (!code || !POSTCODE_RE.test(code)) return null;
    const exact = cacheGet<GeoPolygon>(postcodeExactKey(code));
    if (exact && isGeoPolygon(exact)) return exact;
    const fresh = await postcodeArea(code).catch(() => null);
    return fresh ? (cacheGet<GeoPolygon>(postcodeExactKey(code)) ?? null) : null;
  }
  if (!wantsFinePolygon(area.kind) || area.areaSelector.kind !== "relation" || !area.osmRelationId) return null;
  try {
    const { polygon } = await lookupWithOutline({ osmType: "relation", osmId: area.osmRelationId }, area.kind, FINE_MAX_POINTS, FINE_THRESHOLD);
    return polygon;
  } catch {
    return null;
  }
}

/** ISO2 sanity used by the routes' country checks. */
export function validCountryCode(cc: unknown): cc is string {
  return typeof cc === "string" && CC_RE.test(cc);
}

export { countryNameOf };
