// Pure geometry for the finder (docs/finder-ux-spec.md §2.4): point-in-polygon
// over GeoJSON Polygon / MultiPolygon (WGS84 [lng, lat], holes honoured),
// extents, centroids, circles for node/way hits, point counts and haversine
// distances. No imports beyond types, so polygon.test.ts runs under node --test.
import type { GeoPolygon } from "../crm/types.ts";

export type Position = [number, number]; // [lng, lat]
export type Ring = Position[];
export type Bbox = [south: number, west: number, north: number, east: number];

const EARTH_KM = 6371.0088;

function isPosition(x: unknown): x is Position {
  return Array.isArray(x) && x.length >= 2 && typeof x[0] === "number" && typeof x[1] === "number" && Number.isFinite(x[0]) && Number.isFinite(x[1]);
}

/** The polygons of a geometry as lists of rings (outer first); tolerant of odd input. */
export function polygonsOf(geom: GeoPolygon | null | undefined): Ring[][] {
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  const polys = geom.type === "MultiPolygon" ? (geom.coordinates as unknown[]) : [geom.coordinates];
  const out: Ring[][] = [];
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue;
    const rings: Ring[] = [];
    for (const ring of poly) {
      if (!Array.isArray(ring)) continue;
      const pts = ring.filter(isPosition);
      if (pts.length >= 3) rings.push(pts);
    }
    if (rings.length > 0) out.push(rings);
  }
  return out;
}

/** Ray casting: is [lng, lat] inside the ring (boundary counts as inside)? */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    // On a vertex or an edge → inside.
    if ((xi === lng && yi === lat) || (xj === lng && yj === lat)) return true;
    const crosses = yi > lat !== yj > lat;
    if (crosses) {
      const x = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (x === lng) return true;
      if (lng < x) inside = !inside;
    }
  }
  return inside;
}

/** True when the point lies inside any polygon of the geometry and outside its holes. */
export function pointInPolygon(lng: number, lat: number, geom: GeoPolygon | null | undefined): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  for (const rings of polygonsOf(geom)) {
    if (!inRing(lng, lat, rings[0]!)) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) {
      if (inRing(lng, lat, rings[h]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** [s, w, n, e] extent of every ring, or null when the geometry has no points. */
export function bboxOf(geom: GeoPolygon | null | undefined): Bbox | null {
  let s = 90;
  let w = 180;
  let n = -90;
  let e = -180;
  let any = false;
  for (const rings of polygonsOf(geom)) {
    for (const [lng, lat] of rings[0]!) {
      any = true;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
    }
  }
  return any ? [s, w, n, e] : null;
}

/** Area-weighted centroid of the outer rings (shoelace), falling back to the bbox centre for degenerate shapes. */
export function centroidOf(geom: GeoPolygon | null | undefined): { lat: number; lng: number } | null {
  let sumX = 0;
  let sumY = 0;
  let sumA = 0;
  for (const rings of polygonsOf(geom)) {
    const ring = rings[0]!;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      const f = xj * yi - xi * yj;
      a += f;
      cx += (xi + xj) * f;
      cy += (yi + yj) * f;
    }
    if (a !== 0) {
      sumX += cx / 3; // (cx / (3a)) weighted by a → cx / 3
      sumY += cy / 3;
      sumA += a;
    }
  }
  if (sumA !== 0) return { lng: sumX / sumA, lat: sumY / sumA };
  const b = bboxOf(geom);
  return b ? { lat: (b[0] + b[2]) / 2, lng: (b[1] + b[3]) / 2 } : null;
}

/** Number of positions across every ring. */
export function pointCount(geom: GeoPolygon | null | undefined): number {
  let n = 0;
  for (const rings of polygonsOf(geom)) for (const ring of rings) n += ring.length;
  return n;
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A closed n-gon of radius `km` around a point (for node/way hits — an approximate outline). */
export function circlePolygon(lat: number, lng: number, km: number, n = 32): GeoPolygon {
  const ring: Ring = [];
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    ring.push([round6(lng + dLng * Math.cos(t)), round6(lat + dLat * Math.sin(t))]);
  }
  ring.push(ring[0]!);
  return { type: "Polygon", coordinates: [ring] };
}

/** Radius in km from the centre that covers the bbox (register near_point). */
export function bboxRadiusKm(center: { lat: number; lng: number }, b: Bbox): number {
  const corners: { lat: number; lng: number }[] = [
    { lat: b[0], lng: b[1] },
    { lat: b[0], lng: b[3] },
    { lat: b[2], lng: b[1] },
    { lat: b[2], lng: b[3] },
  ];
  return Math.max(...corners.map((c) => haversineKm(center, c)));
}

/** Do two [s,w,n,e] boxes overlap (touching counts)? */
export function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** True when the geometry is a usable Polygon / MultiPolygon. */
export function isGeoPolygon(x: unknown): x is GeoPolygon {
  if (!x || typeof x !== "object") return false;
  const g = x as { type?: unknown; coordinates?: unknown };
  return (g.type === "Polygon" || g.type === "MultiPolygon") && Array.isArray(g.coordinates) && polygonsOf(g as GeoPolygon).length > 0;
}
