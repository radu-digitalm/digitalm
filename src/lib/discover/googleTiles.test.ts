import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GeoPolygon } from "../crm/types.ts";
import { GOOGLE_TYPES } from "./googleRequests.ts";
import { MAX_TILES, MAX_TILE_DEPTH, circleRadiusM, circleRequest, initialTiles, isSaturated, orderTiles, splitTile, tileCount, tileTouches, type Tile } from "./googleTiles.ts";
import { bboxOf, haversineKm, pointInPolygon, type Bbox } from "./polygon.ts";

const here = new URL(".", import.meta.url).pathname;
const ariege = JSON.parse(readFileSync(`${here}fixtures/ariege.polygon.json`, "utf8")).geojson as GeoPolygon;
const ARIEGE = { bbox: bboxOf(ariege)!, polygon: ariege, center: { lat: 42.9455368, lng: 1.4065544 } };

test("tileCount: 292 → 8; unknown → 1; tiny → 1; huge → 16", () => {
  assert.equal(tileCount(292), 8);
  assert.equal(tileCount(null), 1);
  assert.equal(tileCount(200), 6);
  assert.equal(tileCount(10), 1);
  assert.equal(tileCount(0), 1);
  assert.equal(tileCount(5_000), MAX_TILES);
});

test("Ariège / 292: a 3×3 grid, every kept cell touches the outline, ordered from the centre outward", () => {
  const tiles = initialTiles(ARIEGE, 292);
  assert.ok(tiles.length >= 1 && tiles.length <= 9);
  assert.equal(tiles.length, 9); // the department fills its bounding box at this grain
  for (const t of tiles) {
    assert.match(t.id, /^g[0-2]_[0-2]$/);
    assert.equal(t.depth, 0);
    assert.equal(tileTouches(t.rect, ariege, ARIEGE.bbox), true, t.id);
  }
  const d = tiles.map((t) => haversineKm(ARIEGE.center, { lat: (t.rect[0] + t.rect[2]) / 2, lng: (t.rect[1] + t.rect[3]) / 2 }));
  for (let i = 1; i < d.length; i++) assert.ok(d[i]! >= d[i - 1]!, `tile ${i} is nearer than tile ${i - 1}`);
  assert.equal(tiles[0]!.id, "g1_1");
  // The grid covers the bbox exactly.
  const s = Math.min(...tiles.map((t) => t.rect[0]));
  const n = Math.max(...tiles.map((t) => t.rect[2]));
  assert.ok(Math.abs(s - ARIEGE.bbox[0]) < 1e-9 && Math.abs(n - ARIEGE.bbox[2]) < 1e-9);
});

test("cells that miss the polygon are dropped (an L shape loses its empty corner); no polygon → the bbox alone", () => {
  // An L: the square [0,0]-[3,3] without the [1.5,1.5]-[3,3] corner (the notch is wider than a cell, so the corner cell shares no boundary point).
  const L: GeoPolygon = { type: "Polygon", coordinates: [[[0, 0], [3, 0], [3, 1.5], [1.5, 1.5], [1.5, 3], [0, 3], [0, 0]]] };
  const area = { bbox: [0, 0, 3, 3] as Bbox, polygon: L, center: { lat: 1, lng: 1 } };
  const tiles = initialTiles(area, 300); // 8 → 3×3, cells of 1°
  const ids = tiles.map((t) => t.id).sort();
  assert.equal(ids.includes("g2_2"), false, "the empty corner cell goes");
  assert.equal(tiles.length, 8);
  // Rule §3.3: the probes are OUR tile corners — none of them is a Google coordinate.
  assert.equal(tileTouches([2.1, 2.1, 2.9, 2.9], L, [0, 0, 3, 3]), false);
  assert.equal(tileTouches([1, 1, 2, 2], L, [0, 0, 3, 3]), true);
  assert.equal(pointInPolygon(2.5, 2.5, L), false);
  const bare = initialTiles({ bbox: [0, 0, 1, 1], polygon: null, center: { lat: 0.5, lng: 0.5 } }, null);
  assert.equal(bare.length, 1);
  assert.equal(initialTiles({ bbox: [0, 0, 1, 1], polygon: null, center: { lat: 0.5, lng: 0.5 } }, 200).length, 9); // 6 → 3×3, nothing to clip
  const one = initialTiles({ bbox: [0, 0, 1, 1], polygon: null, center: { lat: 0.5, lng: 0.5 } }, 10);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0]!.rect, [0, 0, 1, 1]);
});

test("`ran` boxes keep only the intersecting cells — a tile-mode plan and a children-mode plan with unit bboxes", () => {
  // A capped search that ran one tile-mode unit around Foix / Pamiers.
  const tileMode = initialTiles(ARIEGE, 292, [[42.9, 1.5, 43.15, 1.75]]);
  assert.deepEqual(tileMode.map((t) => t.id).sort(), ["g1_1", "g1_2", "g2_1", "g2_2"]);
  // Children mode: two communes with their own boxes (west and centre).
  const children: Bbox[] = [
    [42.95, 1.1, 43.02, 1.2], // Saint-Girons
    [42.94, 1.58, 42.99, 1.63], // Foix
  ];
  const childMode = initialTiles(ARIEGE, 292, children);
  assert.deepEqual(childMode.map((t) => t.id).sort(), ["g1_0", "g1_1"]);
  // No unit ran at all → nothing to ask.
  assert.deepEqual(initialTiles(ARIEGE, 292, [[10, 10, 11, 11]]), []);
});

test("splitTile: four quadrants one level deeper, nothing past depth 3", () => {
  const t: Tile = { id: "g0_0", rect: [0, 0, 2, 4], depth: 0 };
  const q = splitTile(t);
  assert.equal(q.length, 4);
  assert.deepEqual(q.map((x) => x.rect), [
    [0, 0, 1, 2],
    [0, 2, 1, 4],
    [1, 0, 2, 2],
    [1, 2, 2, 4],
  ]);
  assert.deepEqual(q.map((x) => x.id), ["g0_0.0", "g0_0.1", "g0_0.2", "g0_0.3"]);
  assert.ok(q.every((x) => x.depth === 1));
  let deep: Tile = t;
  for (let i = 0; i < MAX_TILE_DEPTH; i++) deep = splitTile(deep)[0]!;
  assert.equal(deep.depth, MAX_TILE_DEPTH);
  assert.deepEqual(splitTile(deep), []);
});

test("isSaturated: three full pages, or a token left after the third page", () => {
  assert.equal(isSaturated(3, 60, null), true);
  assert.equal(isSaturated(3, 45, "tok"), true);
  assert.equal(isSaturated(3, 45, null), false);
  assert.equal(isSaturated(2, 40, "tok"), false);
  assert.equal(isSaturated(1, 12, null), false);
});

test("orderTiles: nearest the centre first, ties by id", () => {
  const tiles: Tile[] = [
    { id: "b", rect: [0, 0, 1, 1], depth: 0 },
    { id: "a", rect: [0, 0, 1, 1], depth: 0 },
    { id: "far", rect: [5, 5, 6, 6], depth: 0 },
    { id: "near", rect: [0.4, 0.4, 0.6, 0.6], depth: 1 },
  ];
  assert.deepEqual(orderTiles(tiles, { lat: 0.5, lng: 0.5 }).map((t) => t.id), ["a", "b", "near", "far"]);
});

test("circle areas: a Table A type → one Nearby Search; a text-only trade → one biased Text Search; radius ≤ 50 km", () => {
  const foix = { center: { lat: 42.9646, lng: 1.6053 }, radiusKm: 4, countryCode: "FR" };
  const nearby = circleRequest(foix, GOOGLE_TYPES.restaurant!, "fr", "fr");
  assert.equal(nearby.kind, "nearby");
  assert.equal(nearby.path, "/v1/places:searchNearby");
  if (nearby.kind === "nearby") {
    assert.deepEqual(nearby.body.includedTypes, ["restaurant"]);
    assert.equal(nearby.body.locationRestriction.circle.radius, 4000);
    assert.equal(nearby.body.languageCode, "fr");
  }
  const text = circleRequest(foix, GOOGLE_TYPES.joiner!, "fr", "fr");
  assert.equal(text.kind, "text");
  assert.equal(text.path, "/v1/places:searchText");
  if (text.kind === "text") {
    assert.equal(text.body.textQuery, "menuisier");
    assert.equal(text.body.strictTypeFiltering, false);
    assert.deepEqual(text.body.locationBias, { circle: { center: { latitude: 42.9646, longitude: 1.6053 }, radius: 4000 } });
    assert.equal("locationRestriction" in text.body, false);
  }
  const custom = circleRequest(foix, { includedType: null, query: { fr: "Tatoueur", en: "Tattoo studio" } }, "en");
  assert.equal(custom.kind, "text");
  if (custom.kind === "text") assert.equal(custom.body.textQuery, "Tattoo studio");
  assert.equal(circleRadiusM({ radiusKm: 75 }), 50_000);
  assert.equal(circleRadiusM({ radiusKm: 0.01 }), 100);
  const big = circleRequest({ ...foix, radiusKm: 120 }, GOOGLE_TYPES.bar!, "fr");
  if (big.kind === "nearby") assert.equal(big.body.locationRestriction.circle.radius, 50_000);
});
