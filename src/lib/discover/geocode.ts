// Area geocoding for discovery (contract §6 "Geocoding"). French input goes to
// geo.api.gouv.fr (commune contour → bbox, postcodes, INSEE code); everything
// else to Nominatim (identifying User-Agent, ≥ 1100 ms between calls, never in
// parallel). Results are cached 30 days in api_cache; only area-level lookups
// ever happen here — never one per business.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { Area } from "@/lib/crm/types";

/** Error with a stable code the API routes map to a status (404 / 422 / 502). */
export class DiscoverError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 422, message = code) {
    super(message);
    this.name = "DiscoverError";
    this.code = code;
    this.status = status;
  }
}

export type Bbox = Area["bbox"];

export const MAX_AREA_DEG2 = 1.5;
export const TILE_DEG = 0.25;
export const MAX_TILES = 24;
const GEO_CACHE_MS = 30 * DAY_MS;
const NOMINATIM_GAP_MS = 1100;

export function bboxAreaDeg2(b: Bbox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/** Split a bbox into tiles of at most TILE_DEG a side, row-major; ≤ MAX_TILES for any accepted area. */
export function tilesFor(b: Bbox): Bbox[] {
  const rows = Math.max(1, Math.ceil((b[2] - b[0]) / TILE_DEG));
  const cols = Math.max(1, Math.ceil((b[3] - b[1]) / TILE_DEG));
  const dLat = (b[2] - b[0]) / rows;
  const dLng = (b[3] - b[1]) / cols;
  const tiles: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push([b[0] + r * dLat, b[1] + c * dLng, r === rows - 1 ? b[2] : b[0] + (r + 1) * dLat, c === cols - 1 ? b[3] : b[1] + (c + 1) * dLng]);
    }
  }
  return tiles;
}

/** Radius in km that covers the bbox from its centre (for the register's lat/long/radius fallback). */
export function bboxRadiusKm(area: Area): number {
  const { lat, lng } = area.center;
  const [s, w, n, e] = area.bbox;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = Math.max(Math.abs(n - lat), Math.abs(lat - s));
  const dLng = Math.max(Math.abs(e - lng), Math.abs(lng - w)) * Math.cos(toRad(lat));
  return Math.sqrt(dLat ** 2 + dLng ** 2) * 111.2;
}

function assertSize(bbox: Bbox): void {
  if (bboxAreaDeg2(bbox) > MAX_AREA_DEG2 || tilesFor(bbox).length > MAX_TILES) {
    throw new DiscoverError("area_too_large", 422, "Area is too large — search a town or a department, not a region");
  }
}

// ---- input classification -------------------------------------------------------

const POSTCODE_RE = /^\d{5}$/;
const DEPARTEMENT_RE = /^(0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/i;
const CC_RE = /^[A-Z]{2}$/;

function countryHint(hint: string | undefined): string | null {
  const h = (hint ?? "").trim().toUpperCase();
  return CC_RE.test(h) ? h : null;
}

// ---- geo.api.gouv.fr ---------------------------------------------------------------

type GeoPoint = { type: "Point"; coordinates: [number, number] };
type GeoCommune = {
  nom: string;
  code: string;
  codeDepartement?: string;
  codesPostaux?: string[];
  centre?: GeoPoint;
  contour?: { type: string; coordinates: unknown };
  population?: number;
};

const COMMUNE_FIELDS = "nom,code,codeDepartement,codesPostaux,centre,contour,population";

/** Walk any GeoJSON coordinate nesting and return the [s,w,n,e] extent. */
function extentOf(coords: unknown, acc: { s: number; w: number; n: number; e: number }): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    const lng = coords[0];
    const lat = coords[1];
    if (lat < acc.s) acc.s = lat;
    if (lat > acc.n) acc.n = lat;
    if (lng < acc.w) acc.w = lng;
    if (lng > acc.e) acc.e = lng;
    return;
  }
  for (const c of coords) extentOf(c, acc);
}

function extentBbox(coords: unknown): Bbox | null {
  const acc = { s: 90, w: 180, n: -90, e: -180 };
  extentOf(coords, acc);
  if (acc.s > acc.n || acc.w > acc.e) return null;
  return [acc.s, acc.w, acc.n, acc.e];
}

async function geoGouv<T>(path: string): Promise<T> {
  const url = `${HOSTS.geoGouv}${path}`;
  const { value, hit } = await cached<{ data: T }>("geo_gouv", { url }, GEO_CACHE_MS, async () => {
    const res = await fetchJson<T>(url, { timeoutMs: 12_000 });
    return { data: res.data };
  });
  if (!hit) countApiUsage("geo_gouv");
  return value.data;
}

function communeToArea(c: GeoCommune): Area | null {
  if (!c.centre?.coordinates) return null;
  const [lng, lat] = c.centre.coordinates;
  const bbox = (c.contour ? extentBbox(c.contour.coordinates) : null) ?? [lat - 0.03, lng - 0.04, lat + 0.03, lng + 0.04];
  return {
    label: `${c.nom}${c.codesPostaux?.[0] ? ` (${c.codesPostaux[0]})` : ""}`,
    countryCode: "FR",
    center: { lat, lng },
    bbox,
    admin: {
      postcodes: c.codesPostaux ?? [],
      inseeCode: c.code,
      departement: c.codeDepartement ?? c.code.slice(0, 2),
      locality: c.nom,
    },
    provider: "geo_gouv",
  };
}

async function geoGouvCommune(params: { nom?: string; codePostal?: string }): Promise<Area | null> {
  const qs = new URLSearchParams({ fields: COMMUNE_FIELDS, boost: "population", limit: "1" });
  if (params.codePostal) qs.set("codePostal", params.codePostal);
  else if (params.nom) qs.set("nom", params.nom);
  else return null;
  const list = await geoGouv<GeoCommune[]>(`/communes?${qs.toString()}`);
  const first = Array.isArray(list) ? list[0] : undefined;
  return first ? communeToArea(first) : null;
}

async function geoGouvDepartement(code: string): Promise<Area | null> {
  const dep = await geoGouv<{ nom: string; code: string }>(`/departements/${encodeURIComponent(code.toUpperCase())}`).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  });
  if (!dep) return null;
  const communes = await geoGouv<GeoCommune[]>(`/departements/${encodeURIComponent(dep.code)}/communes?fields=centre,codesPostaux`);
  const acc = { s: 90, w: 180, n: -90, e: -180 };
  const postcodes = new Set<string>();
  for (const c of communes ?? []) {
    if (c.centre?.coordinates) extentOf(c.centre.coordinates, acc);
    for (const p of c.codesPostaux ?? []) postcodes.add(p);
  }
  if (acc.s > acc.n) return null;
  // Centres only — pad so the edge communes' streets fall inside the bbox.
  const bbox: Bbox = [acc.s - 0.03, acc.w - 0.04, acc.n + 0.03, acc.e + 0.04];
  return {
    label: `${dep.nom} (${dep.code})`,
    countryCode: "FR",
    center: { lat: (bbox[0] + bbox[2]) / 2, lng: (bbox[1] + bbox[3]) / 2 },
    bbox,
    admin: { departement: dep.code, postcodes: [...postcodes].sort() },
    provider: "geo_gouv",
  };
}

// ---- Nominatim ------------------------------------------------------------------------

type NominatimHit = {
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [s, n, w, e]
  display_name?: string;
  name?: string;
  address?: Record<string, string>;
};

async function nominatim(q: string, cc: string | null): Promise<NominatimHit | null> {
  const qs = new URLSearchParams({ q, format: "jsonv2", limit: "1", addressdetails: "1" });
  if (cc) qs.set("countrycodes", cc.toLowerCase());
  const url = `${HOSTS.nominatim}/search?${qs.toString()}`;
  const { value, hit } = await cached<{ hit: NominatimHit | null }>("nominatim", { url }, GEO_CACHE_MS, async () => {
    const res = await spaced("nominatim", NOMINATIM_GAP_MS, () => fetchJson<NominatimHit[]>(url, { timeoutMs: 15_000 }));
    const first = Array.isArray(res.data) ? res.data[0] : undefined;
    if (!first) return { hit: null };
    // Keep only what we use: no raw payload lingers in the cache.
    return {
      hit: {
        lat: first.lat,
        lon: first.lon,
        boundingbox: first.boundingbox,
        display_name: first.display_name,
        name: first.name,
        address: first.address,
      },
    };
  });
  if (!hit) countApiUsage("nominatim");
  return value.hit;
}

function nominatimToArea(h: NominatimHit): Area | null {
  const lat = Number(h.lat);
  const lng = Number(h.lon);
  const [s, n, w, e] = (h.boundingbox ?? []).map(Number);
  if (![lat, lng, s, n, w, e].every(Number.isFinite)) return null;
  const a = h.address ?? {};
  const cc = (a.country_code ?? "").toUpperCase();
  const parts = (h.display_name ?? "").split(", ");
  const label = h.name ? (parts.length > 2 ? `${h.name}, ${parts[parts.length - 2]}` : h.name) : parts[0] ?? "";
  const locality = a.city ?? a.town ?? a.village ?? a.municipality ?? h.name;
  return {
    label,
    countryCode: CC_RE.test(cc) ? cc : "XX",
    center: { lat, lng },
    bbox: [s!, w!, n!, e!],
    admin: { locality, postcodes: a.postcode ? [a.postcode] : undefined },
    provider: "nominatim",
  };
}

// ---- entry point ------------------------------------------------------------------------

/**
 * Resolve free text ("Foix", "09000", "09", "Havant", "Portland, Oregon") to an
 * Area. `hint` is an optional ISO2 country. Throws DiscoverError
 * area_not_found (404) or area_too_large (422); network failures surface as
 * DiscoverError geocode_failed (502).
 */
export async function geocodeArea(query: string, hint?: string): Promise<Area> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!q) throw new DiscoverError("area_not_found", 404, "Type a town, a postcode or a department");
  const cc = countryHint(hint);
  let area: Area | null = null;
  try {
    if (POSTCODE_RE.test(q) && (cc === null || cc === "FR")) {
      area = await geoGouvCommune({ codePostal: q });
    } else if (DEPARTEMENT_RE.test(q) && (cc === null || cc === "FR")) {
      area = await geoGouvDepartement(q);
    } else if (cc === "FR") {
      area = (await geoGouvCommune({ nom: q })) ?? nominatimFallback(await nominatim(q, "FR"));
    } else {
      const hit = await nominatim(q, cc);
      const fromNominatim = hit ? nominatimToArea(hit) : null;
      if (fromNominatim?.countryCode === "FR") {
        // Nominatim says France: prefer the commune contour + postcodes from geo.gouv.
        const nom = fromNominatim.admin?.locality ?? q;
        area = (await geoGouvCommune({ nom })) ?? fromNominatim;
      } else {
        area = fromNominatim;
      }
    }
  } catch (e) {
    if (e instanceof DiscoverError) throw e;
    const code = e instanceof HttpError ? e.code : "network";
    throw new DiscoverError("geocode_failed", 502, `Geocoding failed (${code})`);
  }
  if (!area) throw new DiscoverError("area_not_found", 404, `No area found for "${q}"`);
  assertSize(area.bbox);
  return area;
}

function nominatimFallback(hit: NominatimHit | null): Area | null {
  return hit ? nominatimToArea(hit) : null;
}
