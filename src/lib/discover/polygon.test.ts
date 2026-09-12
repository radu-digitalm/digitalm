import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bboxOf, bboxRadiusKm, bboxesOverlap, centroidOf, circlePolygon, haversineKm, isGeoPolygon, pointCount, pointInPolygon, roundPolygon, simplifyPolygon } from "./polygon.ts";
import type { GeoPolygon } from "../crm/types.ts";

const here = new URL(".", import.meta.url).pathname;
const display = JSON.parse(readFileSync(`${here}fixtures/ariege.polygon.json`, "utf8")).geojson as GeoPolygon;
const fine = JSON.parse(readFileSync(`${here}fixtures/ariege.fine.polygon.json`, "utf8")).geojson as GeoPolygon;

// [lng, lat]
const FOIX = [1.6053, 42.9646] as const;
const PAMIERS = [1.6111, 43.1167] as const;
const LA_MASSANA_AD = [1.515, 42.545] as const;
const FORMIGUERES_66 = [2.11, 42.61] as const;
const CAMURAC_11 = [1.92, 42.79] as const;

test("pointInPolygon: Ariège display outline (205 pts) keeps Foix and Pamiers, rejects Andorra, 66 and 11", () => {
  assert.equal(pointCount(display), 205);
  assert.equal(pointInPolygon(...FOIX, display), true);
  assert.equal(pointInPolygon(...PAMIERS, display), true);
  assert.equal(pointInPolygon(...LA_MASSANA_AD, display), false);
  assert.equal(pointInPolygon(...FORMIGUERES_66, display), false);
  assert.equal(pointInPolygon(...CAMURAC_11, display), false);
});

test("pointInPolygon: Ariège fine outline (11,964 pts) agrees", () => {
  assert.equal(pointCount(fine), 11964);
  assert.equal(pointInPolygon(...FOIX, fine), true);
  assert.equal(pointInPolygon(...PAMIERS, fine), true);
  assert.equal(pointInPolygon(...LA_MASSANA_AD, fine), false);
  assert.equal(pointInPolygon(...FORMIGUERES_66, fine), false);
  assert.equal(pointInPolygon(...CAMURAC_11, fine), false);
});

test("pointInPolygon: a hole is outside, the boundary is inside, junk is outside", () => {
  const square: GeoPolygon = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  assert.equal(pointInPolygon(2, 2, square), true);
  assert.equal(pointInPolygon(5, 5, square), false);
  assert.equal(pointInPolygon(4, 5, square), false); // on the hole's boundary → in the hole
  assert.equal(pointInPolygon(0, 5, square), true); // on the outer boundary
  assert.equal(pointInPolygon(11, 5, square), false);
  assert.equal(pointInPolygon(Number.NaN, 5, square), false);
  assert.equal(pointInPolygon(5, 5, null), false);
  assert.equal(pointInPolygon(5, 5, { type: "Polygon", coordinates: "nope" }), false);
});

test("pointInPolygon: MultiPolygon — either part counts, the gap between them does not", () => {
  const two: GeoPolygon = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
    ],
  };
  assert.equal(pointInPolygon(0.5, 0.5, two), true);
  assert.equal(pointInPolygon(5.5, 5.5, two), true);
  assert.equal(pointInPolygon(3, 3, two), false);
  assert.deepEqual(bboxOf(two), [0, 0, 6, 6]);
  assert.equal(pointCount(two), 10);
});

test("bboxOf / centroidOf on Ariège match Nominatim's bounding box and land near the department centre", () => {
  const b = bboxOf(display)!;
  assert.ok(Math.abs(b[0] - 42.5732) < 0.01 && Math.abs(b[2] - 43.3163) < 0.01, `south/north ${b}`);
  assert.ok(Math.abs(b[1] - 0.8268) < 0.01 && Math.abs(b[3] - 2.1758) < 0.01, `west/east ${b}`);
  const c = centroidOf(display)!;
  assert.ok(Math.abs(c.lat - 42.93) < 0.1 && Math.abs(c.lng - 1.5) < 0.15, JSON.stringify(c));
  assert.equal(pointInPolygon(c.lng, c.lat, display), true);
  assert.equal(centroidOf(null), null);
  assert.equal(bboxOf({ type: "Polygon", coordinates: [] }), null);
});

test("circlePolygon: n + 1 closed points, every vertex about `km` from the centre", () => {
  const c = circlePolygon(42.9646, 1.6053, 4, 32);
  assert.equal(c.type, "Polygon");
  assert.equal(pointCount(c), 33);
  const ring = (c.coordinates as [number, number][][])[0]!;
  assert.deepEqual(ring[0], ring[32]);
  for (const [lng, lat] of ring) {
    const d = haversineKm({ lat: 42.9646, lng: 1.6053 }, { lat, lng });
    assert.ok(Math.abs(d - 4) < 0.05, `vertex at ${d.toFixed(3)} km`);
  }
  assert.equal(pointInPolygon(1.6053, 42.9646, c), true);
  assert.equal(pointInPolygon(1.66, 42.9646, c), false); // ~4.5 km east
  assert.equal(isGeoPolygon(c), true);
  assert.equal(isGeoPolygon({ type: "Point", coordinates: [1, 2] }), false);
});

test("simplifyPolygon thins the fine Ariège outline under a cap and keeps the test points on the right side; roundPolygon rounds to 5 dp", () => {
  const thin = simplifyPolygon(fine, 1000);
  assert.ok(pointCount(thin) <= 1000 && pointCount(thin) >= 100, `${pointCount(thin)} points`);
  assert.equal(thin.type, "Polygon");
  assert.equal(pointInPolygon(...FOIX, thin), true);
  assert.equal(pointInPolygon(...PAMIERS, thin), true);
  assert.equal(pointInPolygon(...LA_MASSANA_AD, thin), false);
  assert.equal(pointInPolygon(...CAMURAC_11, thin), false);
  assert.equal(simplifyPolygon(display, 5000), display); // under the cap → untouched
  const multi: GeoPolygon = { type: "MultiPolygon", coordinates: [fine.coordinates, display.coordinates] };
  const thinMulti = simplifyPolygon(multi, 600);
  assert.equal(thinMulti.type, "MultiPolygon");
  assert.ok(pointCount(thinMulti) <= 600);
  const rounded = roundPolygon({ type: "Polygon", coordinates: [[[1.123456789, 42.987654321], [1.2, 42.9], [1.3, 43.0], [1.123456789, 42.987654321]]] });
  assert.deepEqual(rounded.coordinates, [[[1.12346, 42.98765], [1.2, 42.9], [1.3, 43.0], [1.12346, 42.98765]]]);
  assert.equal(pointInPolygon(...FOIX, roundPolygon(display)), true);
});

test("haversineKm / bboxRadiusKm / bboxesOverlap", () => {
  assert.ok(Math.abs(haversineKm({ lat: 42.9646, lng: 1.6053 }, { lat: 43.1167, lng: 1.6111 }) - 16.9) < 0.3);
  assert.equal(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
  const r = bboxRadiusKm({ lat: 42.9455, lng: 1.4066 }, [42.5732, 0.8268, 43.3163, 2.1758]);
  assert.ok(r > 60 && r < 80, `radius ${r}`);
  assert.equal(bboxesOverlap([0, 0, 1, 1], [1, 1, 2, 2]), true);
  assert.equal(bboxesOverlap([0, 0, 1, 1], [1.1, 1.1, 2, 2]), false);
});
