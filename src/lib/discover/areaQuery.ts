// Overpass QL for the finder (docs/finder-ux-spec.md §2.5) — pure, so the
// injection guards are unit-tested. An area selector becomes an Overpass area
// statement (relation id → area id 3.6e9 + id, an INSEE set, or an `around`
// radius); tag keys/values, ids, codes, radii and bounding boxes are validated
// and anything else throws AreaQueryError, which the route maps to 400 bad_area.
import type { AreaSelector, Category } from "../crm/types.ts";

export const AREA_OFFSET = 3_600_000_000;
export const MAX_REL_ID = 99_999_999;
export const MAX_AROUND_M = 20_000;
export const UNIT_LIMIT = 5_000; // `out … 5000` — a unit answering exactly this many is flagged truncated
export const TAG_KEY_RE = /^[a-z_:]{2,40}$/;
export const TAG_VALUE_RE = /^[a-z_]{2,40}$/;
export const INSEE_RE = /^\d[0-9AB]\d{3}$/;
export const ADMIN_LEVELS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]);

export type Bbox = [south: number, west: number, north: number, east: number];

export class AreaQueryError extends Error {
  code = "bad_area";
  constructor(message: string) {
    super(message);
    this.name = "AreaQueryError";
  }
}

function assertRelId(id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > MAX_REL_ID) throw new AreaQueryError("bad relation id");
}

/** Overpass area id of an OSM relation. */
export function areaIdOf(relId: number): number {
  assertRelId(relId);
  return AREA_OFFSET + relId;
}

function num(x: unknown, digits: number): string {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new AreaQueryError("bad coordinate");
  return x.toFixed(digits);
}

function bboxText(b: Bbox): string {
  if (!Array.isArray(b) || b.length !== 4) throw new AreaQueryError("bad bbox");
  const [s, w, n, e] = b;
  if (![s, w, n, e].every((x) => typeof x === "number" && Number.isFinite(x))) throw new AreaQueryError("bad bbox");
  if (s < -90 || n > 90 || w < -180 || e > 180 || s >= n || w >= e) throw new AreaQueryError("bad bbox");
  return `${num(s, 5)},${num(w, 5)},${num(n, 5)},${num(e, 5)}`;
}

function assertSelector(sel: AreaSelector): void {
  if (!sel || typeof sel !== "object") throw new AreaQueryError("bad selector");
  if (sel.kind === "relation") assertRelId(sel.relId);
  else if (sel.kind === "insee") {
    if (!Array.isArray(sel.codes) || sel.codes.length === 0 || sel.codes.length > 200) throw new AreaQueryError("bad INSEE set");
    for (const c of sel.codes) if (typeof c !== "string" || !INSEE_RE.test(c)) throw new AreaQueryError("bad INSEE code");
  } else if (sel.kind === "around") {
    if (!Number.isInteger(sel.m) || sel.m < 1 || sel.m > MAX_AROUND_M) throw new AreaQueryError("bad radius");
    num(sel.lat, 6);
    num(sel.lng, 6);
    if (sel.lat < -90 || sel.lat > 90 || sel.lng < -180 || sel.lng > 180) throw new AreaQueryError("bad centre");
  } else throw new AreaQueryError("bad selector");
}

/** `…->.a;` statement defining the area set, or "" for an `around` selector (which has no area). */
export function selectorStatement(sel: AreaSelector): string {
  assertSelector(sel);
  if (sel.kind === "relation") return `area(${areaIdOf(sel.relId)})->.a;`;
  if (sel.kind === "insee") return `(${sel.codes.map((c) => `area["ref:INSEE"="${c}"]["boundary"="administrative"];`).join("")})->.a;`;
  return "";
}

/** The spatial filter(s) appended to each nwr clause. */
function spatialFilter(sel: AreaSelector, bbox?: Bbox): string {
  assertSelector(sel);
  if (sel.kind === "around") return `(around:${sel.m},${num(sel.lat, 6)},${num(sel.lng, 6)})`;
  return `(area.a)${bbox ? `(${bboxText(bbox)})` : ""}`;
}

/** Validated tag pairs of a category; throws when any pair is malformed or none is left. */
export function tagClauses(category: Pick<Category, "osm">): { k: string; v: string }[] {
  const tags = Array.isArray(category?.osm) ? category.osm : [];
  if (tags.length === 0 || tags.length > 8) throw new AreaQueryError("bad tags");
  for (const t of tags) if (!t || !TAG_KEY_RE.test(t.k) || !TAG_VALUE_RE.test(t.v)) throw new AreaQueryError("bad tag");
  return tags.map((t) => ({ k: t.k, v: t.v }));
}

function nwrUnion(category: Pick<Category, "osm">, filter: string): string {
  return `(${tagClauses(category)
    .map((t) => `nwr["${t.k}"="${t.v}"]${filter};`)
    .join("")})`;
}

/** One unit: everything with the trade's tags inside the area (clipped by `bbox` for tiles), centres + tags, ≤ 5,000. */
export function unitQuery(category: Pick<Category, "osm">, sel: AreaSelector, bbox?: Bbox): string {
  return `[out:json][timeout:60][maxsize:67108864];${selectorStatement(sel)}${nwrUnion(category, spatialFilter(sel, bbox))};out center tags ${UNIT_LIMIT};`;
}

/** The estimate: how many elements the whole area holds for the trade (server-side timeout 5…120 s). */
export function countQuery(category: Pick<Category, "osm">, sel: AreaSelector, timeoutS = 30): string {
  if (!Number.isInteger(timeoutS) || timeoutS < 5 || timeoutS > 120) throw new AreaQueryError("bad timeout");
  return `[out:json][timeout:${timeoutS}];${selectorStatement(sel)}${nwrUnion(category, spatialFilter(sel))};out count;`;
}

/** Administrative children of a relation / INSEE-set area at one admin level (names, codes, centres). */
export function childrenQuery(sel: AreaSelector, level: number): string {
  if (!ADMIN_LEVELS.has(level)) throw new AreaQueryError("bad admin level");
  if (sel.kind === "around") throw new AreaQueryError("no children for a radius");
  return `[out:json][timeout:60];${selectorStatement(sel)}rel(area.a)["boundary"="administrative"]["type"="boundary"]["admin_level"="${level}"];out tags center;`;
}

/**
 * Commune / municipality boundaries (admin_level 8, or 7 where a country has
 * no 8 — Andorra's parishes) for the town fill (§3.8): inside a unit's area,
 * or — with a null selector — inside a bounding box alone, which does not
 * depend on the mirror having generated the area.
 */
export function communesQuery(sel: AreaSelector | null, bbox?: Bbox): string {
  if (sel === null) {
    if (!bbox) throw new AreaQueryError("bad bbox");
    return `[out:json][timeout:60];rel["boundary"="administrative"]["admin_level"~"^[78]$"](${bboxText(bbox)});out tags center;`;
  }
  assertSelector(sel);
  const filter = sel.kind === "around" ? spatialFilter(sel) : `(area.a)${bbox ? `(${bboxText(bbox)})` : ""}`;
  return `[out:json][timeout:60];${selectorStatement(sel)}rel["boundary"="administrative"]["admin_level"~"^[78]$"]${filter};out tags center;`;
}

/** The admin_level-8 area containing one point (prospect town backfill, non-FR rows). */
export function containingCommuneQuery(lat: number, lng: number): string {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new AreaQueryError("bad centre");
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new AreaQueryError("bad centre");
  return `[out:json][timeout:30];is_in(${num(lat, 6)},${num(lng, 6)})->.a;area.a["boundary"="administrative"]["admin_level"="8"];out tags;`;
}
