import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UNIT_SPLIT_THRESHOLD, capReached, childUnits, chooseLevel, findMaxMs, findMaxRows, findMaxUnits, needsSplit, orderUnits, overCap, planUnits, tileUnits, type ChildRel } from "./plan.ts";
import { haversineKm, pointInPolygon } from "./polygon.ts";
import type { GeoPolygon } from "../crm/types.ts";

const here = new URL(".", import.meta.url).pathname;
const ariege = JSON.parse(readFileSync(`${here}fixtures/ariege.polygon.json`, "utf8")).geojson as GeoPolygon;
const area = {
  label: "Ariège",
  kind: "department" as const,
  center: { lat: 42.9455, lng: 1.4066 },
  bbox: [42.5732, 0.8268, 43.3163, 2.1758] as [number, number, number, number],
  polygon: ariege,
  areaSelector: { kind: "relation" as const, relId: 7439 },
  admin: { departement: "09" },
};

const occitanie = { lat: 43.7, lng: 2.2 };
const deps: ChildRel[] = [
  { relId: 7439, name: "Ariège", code: "09", center: { lat: 42.95, lng: 1.41 } },
  { relId: 7413, name: "Haute-Garonne", code: "31", center: { lat: 43.36, lng: 1.17 } },
  { relId: 7462, name: "Lozère", code: "48", center: { lat: 44.52, lng: 3.5 } },
  { relId: 7416, name: "Tarn", code: "81", center: { lat: 43.79, lng: 2.17 } },
  { relId: 7450, name: "Aveyron", code: "12", center: { lat: 44.28, lng: 2.68 } },
];


test("split rule: one unit at or under 5,000 and when the estimate is unknown; split above", () => {
  assert.equal(UNIT_SPLIT_THRESHOLD, 5000);
  assert.equal(needsSplit(292), false);
  assert.equal(needsSplit(5000), false);
  assert.equal(needsSplit(5001), true);
  assert.equal(needsSplit(null), false);
  assert.equal(overCap(12000, 2000), true);
  assert.equal(overCap(2000, 2000), false);
  assert.equal(overCap(null, 2000), false);
  assert.equal(capReached(2000, 2000), true);
  assert.equal(capReached(1999, 2000), false);
  const single = planUnits({ area, expected: 292, children: null, maxUnits: 200 });
  assert.equal(single.mode, "single");
  assert.deepEqual(single.units, [{ id: "r7439", label: "Ariège", code: "09", center: area.center, selector: { kind: "relation", relId: 7439 } }]);
  assert.equal(planUnits({ area, expected: null, children: null, maxUnits: 200 }).mode, "single");
  // a region / country whose estimate is unknown is still split when the caller says so
  assert.equal(planUnits({ area: { ...area, kind: "region" }, expected: null, children: deps, maxUnits: 200, forceSplit: true }).mode, "children");
  assert.equal(planUnits({ area, expected: null, children: null, maxUnits: 200, forceSplit: true }).mode, "tiles");
});


test("unit ordering: from the centre outward, stable on ties", () => {
  const ordered = orderUnits(deps, occitanie);
  assert.deepEqual(
    ordered.map((d) => d.name),
    ["Tarn", "Aveyron", "Haute-Garonne", "Ariège", "Lozère"],
  );
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(haversineKm(occitanie, ordered[i - 1]!.center) <= haversineKm(occitanie, ordered[i]!.center));
  }
  const tie = orderUnits(
    [
      { label: "b", center: { lat: 1, lng: 0 } },
      { label: "a", center: { lat: 0, lng: 1 } },
    ],
    { lat: 0, lng: 0 },
  );
  assert.deepEqual(
    tie.map((t) => t.label),
    ["a", "b"],
  );
});

test("children become units with the relation as selector, capped at maxUnits and ordered", () => {
  const units = childUnits(deps, occitanie, 3);
  assert.equal(units.length, 3);
  assert.deepEqual(units[0], { id: "r7416", label: "Tarn", code: "81", center: { lat: 43.79, lng: 2.17 }, selector: { kind: "relation", relId: 7416 } });
  const plan = planUnits({ area: { ...area, label: "Occitanie", kind: "region", center: occitanie }, expected: 12000, children: deps, maxUnits: 200 });
  assert.equal(plan.mode, "children");
  assert.equal(plan.units.length, 5);
});

test("level choice: 6, then 4, then 8 — the first level with 2…max named children wins", () => {
  const mk = (n: number, prefix: string): ChildRel[] => Array.from({ length: n }, (_, i) => ({ relId: i + 1, name: `${prefix}${i}`, center: { lat: i, lng: i } }));
  const byLevel = (levels: Record<number, ChildRel[] | null>) => (l: number) => levels[l];
  assert.equal(chooseLevel(byLevel({ 6: mk(13, "d") }), 200)?.level, 6);
  assert.equal(chooseLevel(byLevel({ 6: mk(1, "d"), 4: mk(3, "r") }), 200)?.level, 4);
  assert.equal(chooseLevel(byLevel({ 6: mk(250, "d"), 4: mk(1, "r"), 8: mk(30, "c") }), 200)?.level, 8);
  assert.equal(chooseLevel(byLevel({ 6: mk(250, "d"), 4: null, 8: mk(300, "c") }), 200), null);
  assert.equal(chooseLevel(byLevel({ 6: [] }), 200), null);
  // children without a name or a centre are dropped before counting
  const broken: ChildRel[] = [{ relId: 1, name: "", center: { lat: 0, lng: 0 } }, { relId: 2, name: "x", center: { lat: Number.NaN, lng: 0 } }, ...mk(2, "ok")];
  assert.equal(chooseLevel(byLevel({ 6: broken }), 200)?.children.length, 2);
  // a level not fetched (undefined) is skipped, not treated as empty
  assert.equal(chooseLevel(() => undefined, 200), null);
});

test("tile fallback: 0.25° tiles clipped to the outline, ordered from the centre, ids t<row>_<col>", () => {
  const tiles = tileUnits(area, 200);
  assert.ok(tiles.length >= 9 && tiles.length <= 18, `${tiles.length} tiles`);
  for (const t of tiles) {
    assert.match(t.id, /^t\d+_\d+$/);
    assert.deepEqual(t.selector, { kind: "relation", relId: 7439 });
    assert.ok(t.bbox && t.bbox[2] - t.bbox[0] <= 0.25 + 1e-9 && t.bbox[3] - t.bbox[1] <= 0.25 + 1e-9);
  }
  for (let i = 1; i < tiles.length; i++) assert.ok(haversineKm(area.center, tiles[i - 1]!.center) <= haversineKm(area.center, tiles[i]!.center));
  // Tiles cover every restaurant-sized point of the department: Foix and Pamiers each fall in some tile.
  for (const [lng, lat] of [
    [1.6053, 42.9646],
    [1.6111, 43.1167],
  ] as const) {
    assert.ok(pointInPolygon(lng, lat, ariege));
    assert.ok(tiles.some((t) => lat >= t.bbox![0] && lat <= t.bbox![2] && lng >= t.bbox![1] && lng <= t.bbox![3]));
  }
  // A tile wholly outside the outline (the Andorra corner) is not queried at all.
  const outsideOnly = tiles.filter((t) => t.bbox![2] < 42.55);
  assert.equal(outsideOnly.length, 0);
  assert.equal(tileUnits(area, 4).length, 4);
  // Fallback is used when no children fit; a `place` (circle) area never gets children.
  assert.equal(planUnits({ area, expected: 9000, children: null, maxUnits: 200 }).mode, "tiles");
  assert.equal(planUnits({ area: { ...area, kind: "place" }, expected: 9000, children: deps, maxUnits: 200 }).mode, "tiles");
});

test("env ceilings: FIND_MAX_ROWS / FIND_MAX_UNITS / FIND_MAX_MS with defaults", () => {
  assert.equal(findMaxRows({}), 2000);
  assert.equal(findMaxUnits({}), 200);
  assert.equal(findMaxMs({}), 600_000);
  assert.equal(findMaxRows({ FIND_MAX_ROWS: "500" }), 500);
  assert.equal(findMaxRows({ FIND_MAX_ROWS: "0" }), 1);
  assert.equal(findMaxUnits({ FIND_MAX_UNITS: "5000" }), 1000);
  assert.equal(findMaxMs({ FIND_MAX_MS: "junk" }), 600_000);
});
