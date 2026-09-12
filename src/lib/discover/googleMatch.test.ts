import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MATCH_MAX_M, PROSPECT_MATCH_MAX_M, matchPlace, nameTokens, namesAgree, tokenOverlap, type MatchPlace, type MatchRow } from "./googleMatch.ts";
import { parseSearch } from "./googleRequests.ts";

const here = new URL(".", import.meta.url).pathname;
const candidates = parseSearch(JSON.parse(readFileSync(`${here}fixtures/google/text-search.match.json`, "utf8"))).places;

const FOIX = { lat: 42.9646, lng: 1.6053 };
const place = (name: string, lat: number | null, lng: number | null, postcode: string | null = "09000"): MatchPlace => ({ placeId: "ChIJabcdefghijklmnopqrstuvw", name, lat, lng, postcode });
const osm = (key: string, name: string, lat: number, lng: number, postcode?: string): MatchRow => ({ key, name, lat, lng, geoSource: "source", postcode });
const register = (key: string, name: string, postcode: string): MatchRow => ({ key, name, lat: FOIX.lat, lng: FOIX.lng, geoSource: "centre", postcode });

/** ~40 m north of Foix. */
const NEAR = { lat: FOIX.lat + 0.00036, lng: FOIX.lng };
/** ~400 m north of Foix. */
const FAR = { lat: FOIX.lat + 0.0036, lng: FOIX.lng };

test("same name 40 m away matches; 400 m away does not", () => {
  const rows = [osm("osm:node/1", "Le Phoebus", FOIX.lat, FOIX.lng)];
  const hit = matchPlace(place("Le Phoebus", NEAR.lat, NEAR.lng), rows);
  assert.ok(hit);
  assert.equal(hit.key, "osm:node/1");
  assert.ok(hit.distanceM !== null && hit.distanceM > 30 && hit.distanceM < 50, String(hit.distanceM));
  assert.equal(matchPlace(place("Le Phoebus", FAR.lat, FAR.lng), rows), null);
  // The prospect rule (300 m) takes 250 m in its stride.
  const mid = { lat: FOIX.lat + 0.00225, lng: FOIX.lng };
  assert.equal(matchPlace(place("Le Phoebus", mid.lat, mid.lng), rows), null);
  assert.equal(matchPlace(place("Le Phoebus", mid.lat, mid.lng), rows, { maxM: PROSPECT_MATCH_MAX_M })?.key, "osm:node/1");
  assert.ok(MATCH_MAX_M < PROSPECT_MATCH_MAX_M);
});

test("'Le Phoebus Restaurant' vs 'Le Phoebus' matches once the trade word is stripped; a different name 10 m away does not", () => {
  const rows = [osm("osm:node/1", "Le Phoebus", FOIX.lat, FOIX.lng)];
  assert.equal(matchPlace(place("Le Phoebus Restaurant", NEAR.lat, NEAR.lng), rows, { stripWords: ["Restaurant"] })?.key, "osm:node/1");
  assert.equal(matchPlace(place("Le Phoebus Restaurant", NEAR.lat, NEAR.lng), rows)?.key, "osm:node/1"); // "restaurant" is generic anyway
  assert.equal(matchPlace(place("La Table de Foix", FOIX.lat + 0.00009, FOIX.lng), rows), null);
  assert.equal(namesAgree("Boulangerie Dupont", "Dupont", ["Boulangerie", "Bakery"]), true);
  assert.equal(namesAgree("Boulangerie Dupont", "Boulangerie Martin", ["Boulangerie", "Bakery"]), false);
  assert.equal(namesAgree("Chez Marcel", "Chez Marcel SARL"), true);
  assert.deepEqual([...nameTokens("Le Phoebus Restaurant SARL")], ["phoebus"]);
  assert.equal(tokenOverlap("Auberge des Trois Ponts", "Auberge Trois Ponts"), 0.75); // "des" is a 3-char token; 3 shared of 4
  assert.equal(tokenOverlap("Auberge des Trois Ponts", "Auberge des Deux Ponts"), 0.6); // 3 shared of 5 — the threshold, inclusive
  assert.ok(tokenOverlap("Auberge des Trois Ponts", "Auberge des Deux Lacs") < 0.6);
  assert.equal(tokenOverlap("Bar", "Bar"), 0); // only generic words → no identity to compare
});

test("a register row without coordinates matches by postcode only", () => {
  const rows = [register("fr_register:123", "Le Phoebus", "09000")];
  const hit = matchPlace(place("Le Phoebus", FAR.lat, FAR.lng, "09000"), rows);
  assert.ok(hit);
  assert.equal(hit.key, "fr_register:123");
  assert.equal(hit.distanceM, null);
  assert.equal(matchPlace(place("Le Phoebus", FAR.lat, FAR.lng, "09100"), rows), null);
  assert.equal(matchPlace(place("Le Phoebus", FAR.lat, FAR.lng, null), rows), null);
  assert.equal(matchPlace(place("Le Phoebus", null, null, "09 000"), rows)?.key, "fr_register:123");
});

test("the nearest of two rows wins; a place matches at most one row", () => {
  const rows = [osm("osm:node/far", "Le Phoebus", FOIX.lat + 0.001, FOIX.lng), osm("osm:node/near", "Le Phoebus", FOIX.lat + 0.0003, FOIX.lng), register("fr_register:1", "Le Phoebus", "09000")];
  const hit = matchPlace(place("Le Phoebus", FOIX.lat + 0.00035, FOIX.lng), rows);
  assert.equal(hit?.key, "osm:node/near");
  assert.equal(typeof hit?.key, "string");
  // A placed row beats a centre-placed register row with the same postcode.
  assert.equal(matchPlace(place("Le Phoebus", FOIX.lat + 0.00035, FOIX.lng), [rows[2]!, rows[1]!])?.key, "osm:node/near");
});

test("the match fixture: the 40 m candidate is the one that matches the prospect at Foix", () => {
  const prospectRow: MatchRow = { key: "prospect:1", name: "Le Phoebus", lat: FOIX.lat, lng: FOIX.lng, geoSource: "source", postcode: "09000" };
  const hits = candidates.map((c) => matchPlace(c, [prospectRow], { maxM: PROSPECT_MATCH_MAX_M, stripWords: ["Restaurant"] }));
  assert.ok(hits[0]);
  assert.equal(hits[0]!.key, "prospect:1");
  assert.ok(hits[0]!.distanceM !== null && hits[0]!.distanceM < 60);
  assert.equal(hits[1], null); // same name, Tarascon — 13 km away
  assert.equal(hits[2], null); // "Phoebus Pizza" — shares one token of two → 0.5
  assert.equal(hits[3], null); // La Table de Foix
  assert.ok(hits[4]); // "Le Phoebus Bar", 190 m — "bar" is generic, so the names agree and 300 m allows it
});
