import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LOOKUPS_PER_SAVE, coordKey, selectLookups } from "./communeRules.ts";

test("selectLookups: FR rows with source coordinates and an approximate town, deduplicated by the 4-dp key, at most 100", () => {
  const rows = [
    { countryCode: "FR", cityApprox: true, geoSource: "source", lat: 42.96461, lng: 1.60531 },
    { countryCode: "FR", cityApprox: true, geoSource: "source", lat: 42.96462, lng: 1.60529 }, // same 4-dp key
    { countryCode: "FR", cityApprox: false, geoSource: "source", lat: 43.1, lng: 1.6 },
    { countryCode: "GB", cityApprox: true, geoSource: "source", lat: 52.2, lng: 0.1 },
    { countryCode: "FR", cityApprox: true, geoSource: "centre", lat: 42.9, lng: 1.4 },
    { countryCode: "FR", cityApprox: true, geoSource: "source", lat: Number.NaN, lng: 1.4 },
    { countryCode: "FR", cityApprox: true, geoSource: "source", lat: 43.11, lng: 1.61 },
  ];
  const picked = selectLookups(rows);
  assert.deepEqual(
    picked.map((p) => p.key),
    ["42.9646,1.6053", "43.1100,1.6100"],
  );
  assert.equal(picked[0]!.row, rows[0]);
  const many = Array.from({ length: 250 }, (_, i) => ({ countryCode: "FR", cityApprox: true, geoSource: "source", lat: 42 + i / 1000, lng: 1.5 }));
  assert.equal(selectLookups(many).length, MAX_LOOKUPS_PER_SAVE);
  assert.equal(MAX_LOOKUPS_PER_SAVE, 100);
  assert.equal(selectLookups(many, 5).length, 5);
  assert.equal(coordKey(42.96461, 1.60531), "42.9646,1.6053");
});
