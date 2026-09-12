// How an area is worked (docs/finder-ux-spec.md §2.5): the estimate decides
// whether the area is one Overpass request or is split into administrative
// children (admin level 6, then 4, then 8) or, failing that, 0.25° tiles
// clipped by the area; units are ordered from the centre outward so a capped
// search is "the N nearest the centre". Pure — env reads go through intEnv.
import { intEnv } from "../crm/time.ts";
import type { AreaSelector, GeoPolygon, ResolvedArea } from "../crm/types.ts";
import { bboxOf, bboxesOverlap, haversineKm, pointInPolygon, polygonsOf, type Bbox } from "./polygon.ts";

export const UNIT_SPLIT_THRESHOLD = 5_000;
export const TILE_DEG = 0.25;
export const CHILD_LEVELS = [6, 4, 8] as const;
export const DEFAULT_MAX_ROWS = 2_000;
export const DEFAULT_MAX_UNITS = 200;
export const DEFAULT_MAX_MS = 600_000;

type Env = Record<string, string | undefined>;
export const findMaxRows = (env: Env = process.env): number => Math.max(1, intEnv("FIND_MAX_ROWS", DEFAULT_MAX_ROWS, env));
export const findMaxUnits = (env: Env = process.env): number => Math.max(1, Math.min(1000, intEnv("FIND_MAX_UNITS", DEFAULT_MAX_UNITS, env)));
export const findMaxMs = (env: Env = process.env): number => Math.max(10_000, intEnv("FIND_MAX_MS", DEFAULT_MAX_MS, env));

/** An administrative child as Overpass returns it (`out tags center bb`); `bbox` since finder-google (older cached plans lack it). */
export type ChildRel = { relId: number; name: string; code?: string; center: { lat: number; lng: number }; bbox?: Bbox };

/** A unit of work: what to ask Overpass for, plus what the progress shows. */
export type PlanUnit = {
  id: string;
  label: string;
  code?: string;
  center: { lat: number; lng: number };
  selector: AreaSelector;
  bbox?: Bbox;
};

export type PlanMode = "single" | "children" | "tiles";

export function needsSplit(expected: number | null): boolean {
  return expected !== null && Number.isFinite(expected) && expected > UNIT_SPLIT_THRESHOLD;
}

export function overCap(expected: number | null, cap: number): boolean {
  return expected !== null && Number.isFinite(expected) && expected > cap;
}

export function capReached(found: number, cap: number): boolean {
  return found >= cap;
}

/** Nearest the centre first; ties by label (or name), then input order, so the order is stable. */
export function orderUnits<T extends { center: { lat: number; lng: number }; label?: string; name?: string }>(units: readonly T[], center: { lat: number; lng: number }): T[] {
  const text = (u: T) => u.label ?? u.name ?? "";
  return units
    .map((u, i) => ({ u, i, d: haversineKm(center, u.center) }))
    .sort((a, b) => a.d - b.d || text(a.u).localeCompare(text(b.u)) || a.i - b.i)
    .map((x) => x.u);
}

/**
 * Pick the first admin level whose children count is 2…max; `byLevel` is
 * consulted in the spec's order 6, 4, 8 (a level not fetched yet returns
 * undefined and is skipped — the caller fetches lazily).
 */
export function chooseLevel(byLevel: (level: number) => ChildRel[] | null | undefined, max: number): { level: number; children: ChildRel[] } | null {
  for (const level of CHILD_LEVELS) {
    const list = byLevel(level);
    if (!list) continue;
    const usable = list.filter((c) => c.name && Number.isFinite(c.center?.lat) && Number.isFinite(c.center?.lng) && Number.isInteger(c.relId) && c.relId > 0);
    if (usable.length >= 2 && usable.length <= max) return { level, children: usable };
  }
  return null;
}

/** The whole area as one unit. */
export function singleUnit(area: Pick<ResolvedArea, "label" | "center" | "areaSelector" | "admin">): PlanUnit {
  const sel = area.areaSelector;
  const id = sel.kind === "relation" ? `r${sel.relId}` : sel.kind === "insee" ? `insee` : `around`;
  return { id, label: area.label, code: area.admin?.departement, center: area.center, selector: sel };
}

/** Children as units, from the centre outward, at most `max`. */
export function childUnits(children: readonly ChildRel[], center: { lat: number; lng: number }, max: number): PlanUnit[] {
  const units: PlanUnit[] = children.map((c) => ({
    id: `r${c.relId}`,
    label: c.name,
    code: c.code,
    center: c.center,
    selector: { kind: "relation", relId: c.relId },
    ...(c.bbox ? { bbox: c.bbox } : {}),
  }));
  return orderUnits(units, center).slice(0, max);
}

function tileTouchesPolygon(tile: Bbox, polygon: GeoPolygon | null, polyBbox: Bbox): boolean {
  if (!bboxesOverlap(tile, polyBbox)) return false;
  if (!polygon) return true;
  const [s, w, n, e] = tile;
  // Any tile corner or its centre inside the polygon…
  const probes: [number, number][] = [
    [w, s],
    [e, s],
    [w, n],
    [e, n],
    [(w + e) / 2, (s + n) / 2],
  ];
  if (probes.some(([lng, lat]) => pointInPolygon(lng, lat, polygon))) return true;
  // …or any polygon vertex inside the tile.
  for (const rings of polygonsOf(polygon)) {
    for (const [lng, lat] of rings[0]!) if (lat >= s && lat <= n && lng >= w && lng <= e) return true;
  }
  return false;
}

/**
 * 0.25° tiles over the area's bbox that touch the outline, ordered from the
 * centre outward, ids "t<row>_<col>". Each tile queries the parent selector
 * clipped by its box. At most `max` tiles.
 */
export function tileUnits(area: Pick<ResolvedArea, "label" | "center" | "areaSelector" | "bbox" | "polygon">, max: number, tileDeg = TILE_DEG): PlanUnit[] {
  const polyBbox = (area.polygon ? bboxOf(area.polygon) : null) ?? area.bbox;
  const [s, w, n, e] = polyBbox;
  const rows = Math.max(1, Math.ceil((n - s) / tileDeg));
  const cols = Math.max(1, Math.ceil((e - w) / tileDeg));
  const units: PlanUnit[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile: Bbox = [s + r * tileDeg, w + c * tileDeg, r === rows - 1 ? n : s + (r + 1) * tileDeg, c === cols - 1 ? e : w + (c + 1) * tileDeg];
      if (tile[0] >= tile[2] || tile[1] >= tile[3]) continue;
      if (!tileTouchesPolygon(tile, area.polygon ?? null, polyBbox)) continue;
      units.push({
        id: `t${r}_${c}`,
        label: `${area.label} (part ${r + 1}-${c + 1})`,
        center: { lat: (tile[0] + tile[2]) / 2, lng: (tile[1] + tile[3]) / 2 },
        selector: area.areaSelector,
        bbox: tile,
      });
    }
  }
  return orderUnits(units, area.center).slice(0, max);
}

/**
 * The unit list for an area: one unit when the estimate is ≤ 5,000 or
 * unknown; else the administrative children (already chosen by level); else
 * tiles. `children` is null when no level fits or the area has none.
 */
export function planUnits(input: {
  area: Pick<ResolvedArea, "label" | "center" | "areaSelector" | "bbox" | "polygon" | "admin" | "kind">;
  expected: number | null;
  children: ChildRel[] | null;
  maxUnits: number;
  /** Split even without an estimate (a region or country whose count the map service could not give). */
  forceSplit?: boolean;
}): { mode: PlanMode; units: PlanUnit[] } {
  if (!needsSplit(input.expected) && !input.forceSplit) return { mode: "single", units: [singleUnit(input.area)] };
  if (input.children && input.children.length >= 2 && input.area.areaSelector.kind !== "around" && input.area.kind !== "place") {
    return { mode: "children", units: childUnits(input.children, input.area.center, input.maxUnits) };
  }
  const tiles = tileUnits(input.area, input.maxUnits);
  return tiles.length > 0 ? { mode: "tiles", units: tiles } : { mode: "single", units: [singleUnit(input.area)] };
}
