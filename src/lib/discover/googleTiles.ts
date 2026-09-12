// How an area is asked of Google (docs/finder-google-spec.md §4.3, "Tiles"):
// a small grid of rectangles over the area's bounding box, clipped by OUR
// polygon (rule §3.3: point-in-polygon runs on our tile corners, never on a
// place Google returned), ordered from the centre outward, split into
// quadrants when a rectangle saturates (60 results), and — for circle areas —
// one Nearby Search (Table A type) or one biased Text Search (text-only
// trade). Pure: polygon.ts only, so googleTiles.test.ts runs under node --test.
import type { GeoPolygon, ResolvedArea } from "../crm/types.ts";
import { nearbySearchBody, textSearchBody, type GoogleTrade, type NearbySearchBody, type TextSearchBody } from "./googleRequests.ts";
import { bboxOf, bboxesOverlap, haversineKm, pointInPolygon, polygonsOf, type Bbox } from "./polygon.ts";

export const MAX_TILES = 16;
export const MAX_TILE_DEPTH = 3;
export const PAGES_PER_TILE = 3;
export const SATURATED_RESULTS = 60;
export const PLACES_PER_TILE = 50;

export type Tile = { id: string; rect: Bbox; depth: number };

/**
 * clamp(ceil(expected × 1.3 / 50), 1, 16) — how many cells the first grid
 * holds; an area the map service could not count starts as one rectangle
 * (saturation splitting takes it from there).
 */
export function tileCount(expected: number | null): number {
  if (expected === null || !Number.isFinite(expected)) return 1;
  const n = Math.ceil((expected * 1.3) / PLACES_PER_TILE);
  return Math.max(1, Math.min(MAX_TILES, n));
}

/** Does the rectangle touch the polygon? Bbox overlap, then a corner / the centre inside, then a polygon vertex inside the cell — all on our own points. */
export function tileTouches(rect: Bbox, polygon: GeoPolygon | null, polyBbox: Bbox): boolean {
  if (!bboxesOverlap(rect, polyBbox)) return false;
  if (!polygon) return true;
  const [s, w, n, e] = rect;
  const probes: [number, number][] = [
    [w, s],
    [e, s],
    [w, n],
    [e, n],
    [(w + e) / 2, (s + n) / 2],
  ];
  if (probes.some(([lng, lat]) => pointInPolygon(lng, lat, polygon))) return true;
  for (const rings of polygonsOf(polygon)) {
    for (const [lng, lat] of rings[0]!) if (lat >= s && lat <= n && lng >= w && lng <= e) return true;
  }
  return false;
}

function centreOf(rect: Bbox): { lat: number; lng: number } {
  return { lat: (rect[0] + rect[2]) / 2, lng: (rect[1] + rect[3]) / 2 };
}

/** Nearest the centre first; ties by id so the order is stable. */
export function orderTiles(tiles: readonly Tile[], center: { lat: number; lng: number }): Tile[] {
  return tiles
    .map((t, i) => ({ t, i, d: haversineKm(center, centreOf(t.rect)) }))
    .sort((a, b) => a.d - b.d || a.t.id.localeCompare(b.t.id) || a.i - b.i)
    .map((x) => x.t);
}

/**
 * The first grid: n cells on a ceil(√n) × ceil(√n) grid over the area's
 * bbox, cells that miss the polygon dropped, cells that miss every `ran` box
 * (a capped search: only the units that ran) dropped too, centre outward.
 */
export function initialTiles(area: Pick<ResolvedArea, "bbox" | "polygon" | "center">, expected: number | null, ran?: readonly Bbox[]): Tile[] {
  const polygon = area.polygon ?? null;
  const polyBbox = (polygon ? bboxOf(polygon) : null) ?? area.bbox;
  const [s, w, n, e] = polyBbox;
  const n0 = tileCount(expected);
  const side = Math.max(1, Math.ceil(Math.sqrt(n0)));
  const dLat = (n - s) / side;
  const dLng = (e - w) / side;
  const tiles: Tile[] = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const rect: Bbox = [s + r * dLat, w + c * dLng, r === side - 1 ? n : s + (r + 1) * dLat, c === side - 1 ? e : w + (c + 1) * dLng];
      if (rect[0] >= rect[2] || rect[1] >= rect[3]) continue;
      if (!tileTouches(rect, polygon, polyBbox)) continue;
      if (ran && !ran.some((b) => bboxesOverlap(rect, b))) continue;
      tiles.push({ id: `g${r}_${c}`, rect, depth: 0 });
    }
  }
  if (tiles.length === 0 && (!ran || ran.length === 0)) tiles.push({ id: "g0_0", rect: [s, w, n, e], depth: 0 });
  return orderTiles(tiles, area.center);
}

/** Four quadrants one level deeper; [] at the depth cap. */
export function splitTile(tile: Tile): Tile[] {
  if (tile.depth >= MAX_TILE_DEPTH) return [];
  const [s, w, n, e] = tile.rect;
  const midLat = (s + n) / 2;
  const midLng = (w + e) / 2;
  const quads: Bbox[] = [
    [s, w, midLat, midLng],
    [s, midLng, midLat, e],
    [midLat, w, n, midLng],
    [midLat, midLng, n, e],
  ];
  return quads.filter((q) => q[0] < q[2] && q[1] < q[3]).map((rect, i) => ({ id: `${tile.id}.${i}`, rect, depth: tile.depth + 1 }));
}

/** A tile whose page budget ran out with a token still present, or that filled three pages, is saturated. */
export function isSaturated(pages: number, results: number, nextPageToken: string | null): boolean {
  return pages >= PAGES_PER_TILE && (nextPageToken !== null || results >= SATURATED_RESULTS);
}

export type CircleRequest = { kind: "nearby"; path: "/v1/places:searchNearby"; body: NearbySearchBody } | { kind: "text"; path: "/v1/places:searchText"; body: TextSearchBody };

/**
 * A circle area (`kind: place`): one Nearby Search with a Table A type, or —
 * for a text-only trade (joiner, optician, custom labels; Nearby takes types,
 * not text) — one Text Search biased to the same circle. Same pool, same SKU.
 */
export function circleRequest(area: Pick<ResolvedArea, "center" | "radiusKm" | "countryCode">, trade: GoogleTrade, languageCode: "fr" | "en", regionCode?: string): CircleRequest {
  const radiusM = Math.max(100, Math.min(50_000, Math.round(area.radiusKm * 1000)));
  if (trade.includedType) {
    return { kind: "nearby", path: "/v1/places:searchNearby", body: nearbySearchBody({ includedTypes: [trade.includedType], center: area.center, radiusM, languageCode, regionCode }) };
  }
  return {
    kind: "text",
    path: "/v1/places:searchText",
    body: textSearchBody({ textQuery: trade.query[languageCode], includedType: null, bias: { lat: area.center.lat, lng: area.center.lng, radiusM }, languageCode, regionCode }),
  };
}

/** The radius (m) a circle area's text results are cut at — a distance from one point, never a polygon test. */
export function circleRadiusM(area: Pick<ResolvedArea, "radiusKm">): number {
  return Math.max(100, Math.min(50_000, Math.round(area.radiusKm * 1000)));
}
