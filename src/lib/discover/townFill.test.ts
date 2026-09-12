import { test } from "node:test";
import assert from "node:assert/strict";
import { TOWN_FILL_KM, coordKey, departementsOfPostcode, nearestCentre, type CentrePoint } from "./townFill.ts";

const centres: CentrePoint[] = [
  { name: "Foix", lat: 42.9646, lng: 1.6053, postcode: "09000", code: "09122" },
  { name: "Saint-Jean-de-Verges", lat: 43.0059, lng: 1.6285, postcode: "09000", code: "09264" },
  { name: "Pamiers", lat: 43.1167, lng: 1.6111, postcode: "09100", code: "09225" },
  { name: "Broken", lat: Number.NaN, lng: 1, postcode: "0" },
];

test("nearestCentre: the closest centre within 6 km, none beyond", () => {
  const near = nearestCentre(centres, 42.97, 1.61)!; // ~700 m from Foix
  assert.equal(near.name, "Foix");
  assert.ok(near.km < 1);
  const between = nearestCentre(centres, 42.99, 1.62)!; // closer to Saint-Jean-de-Verges
  assert.equal(between.name, "Saint-Jean-de-Verges");
  assert.equal(nearestCentre(centres, 43.2, 1.61), null); // ~9.3 km from Pamiers, further from the rest
  assert.equal(nearestCentre(centres, 43.2, 1.61, 12)?.name, "Pamiers");
  assert.equal(nearestCentre(centres, Number.NaN, 1), null);
  assert.equal(nearestCentre([], 42.97, 1.61), null);
  assert.equal(TOWN_FILL_KM, 6);
});

test("nearestCentre: ties by distance keep the first, exact match is 0 km", () => {
  const tie: CentrePoint[] = [
    { name: "A", lat: 0.01, lng: 0 },
    { name: "B", lat: -0.01, lng: 0 },
  ];
  assert.equal(nearestCentre(tie, 0, 0)!.name, "A");
  assert.equal(nearestCentre(centres, 42.9646, 1.6053)!.km, 0);
});

test("coordKey rounds to 4 decimals; departementsOfPostcode handles Corsica and overseas", () => {
  assert.equal(coordKey(42.96461234, 1.60529876), "42.9646,1.6053");
  assert.equal(coordKey(42.96466, 1.6053), "42.9647,1.6053");
  assert.deepEqual(departementsOfPostcode("09000"), ["09"]);
  assert.deepEqual(departementsOfPostcode("20000"), ["2A", "2B"]);
  assert.deepEqual(departementsOfPostcode("97100"), ["971"]);
  assert.deepEqual(departementsOfPostcode("75 008"), ["75"]);
  assert.deepEqual(departementsOfPostcode("CB2 3NR"), []);
  assert.deepEqual(departementsOfPostcode(null), []);
});
