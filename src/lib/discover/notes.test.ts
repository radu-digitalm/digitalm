import { test } from "node:test";
import assert from "node:assert/strict";
import { FORBIDDEN_TOKENS, NOTE_CODES, NOTE_TEXT, fmtNum, hasForbiddenToken, listOf, note, plural } from "./notes.ts";

const SAMPLE = {
  area: "Ariège",
  trade: "restaurants",
  cap: 2000,
  expected: 12000,
  done: 8,
  total: 13,
  list: "Haute-Garonne, Ariège, Aude",
  unit: "Toulouse",
  scope: "Ariège (09)",
  n: 12,
  reason: "did not answer",
  minutes: 10,
  matched: 201,
  only: 23,
};

test("every note code renders a non-empty sentence and echoes its params", () => {
  for (const code of NOTE_CODES) {
    const n = note(code, SAMPLE);
    assert.equal(n.code, code);
    assert.ok(n.text.length > 20, `${code}: "${n.text}"`);
    assert.ok(/[.!]$/.test(n.text.trim()) || n.text.includes("”"), `${code} ends with punctuation: ${n.text}`);
    assert.deepEqual(n.params, SAMPLE);
    assert.equal(NOTE_TEXT[code](SAMPLE), n.text);
  }
  assert.equal("params" in note("google_off"), false);
});

test("no note text contains a forbidden token, with or without params", () => {
  for (const code of NOTE_CODES) {
    for (const params of [SAMPLE, {}]) {
      const text = NOTE_TEXT[code](params);
      assert.equal(hasForbiddenToken(text), null, `${code}: "${text}"`);
    }
  }
  assert.equal(FORBIDDEN_TOKENS.length, 13);
  assert.equal(hasForbiddenToken("OSM: tile 3 failed (http_429)"), "OSM");
  assert.equal(hasForbiddenToken("Results are partial"), "partial");
  assert.equal(hasForbiddenToken("Listing claimed on Google My Business"), "claimed");
  assert.equal(hasForbiddenToken("GMB listing"), "GMB");
  // "verified" is deliberately not a token: the status word "unverified" would trip it.
  assert.equal(hasForbiddenToken("unverified"), null);
});

test("finder-google notes 17–25: text, no tile / partial / claimed, the counts in words", () => {
  const codes = ["google_no_key", "google_discovery_off", "google_failed", "google_refused", "google_allowance", "google_incomplete", "google_outside_dropped", "google_matched", "google_all_parts"] as const;
  for (const code of codes) {
    assert.ok(NOTE_CODES.includes(code), code);
    const text = NOTE_TEXT[code](SAMPLE);
    assert.equal(hasForbiddenToken(text), null, `${code}: "${text}"`);
    assert.doesNotMatch(text, /\btiles?\b/i, code);
    assert.doesNotMatch(text, /\bpartial\b/i, code);
    assert.doesNotMatch(text, /verified|claimed/i, code);
  }
  // The nine Google codes close the catalogue, in the spec's order (the spec numbers them 17–25; the catalogue already held 17 codes).
  assert.deepEqual(NOTE_CODES.slice(-9), codes);
  assert.equal(note("google_incomplete", { done: 6, total: 9, area: "Ariège" }).text, "Google was asked for 6 of 9 parts of Ariège; some businesses known only to Google may be missing.");
  assert.equal(note("google_outside_dropped", { n: 1234, area: "Ariège" }).text, "1,234 Google results outside Ariège were left out.");
  assert.equal(note("google_matched", { matched: 201, only: 23 }).text, "201 also on Google · 23 only on Google.");
  assert.equal(note("google_all_parts", { area: "Ariège" }).text, "Google was asked about the whole of Ariège, not only the parts this search covered.");
  assert.equal(note("google_allowance").text, "The monthly Google search allowance is used up — Google was not asked for this search; what is left is reserved for listing checks.");
  assert.equal(note("google_no_key").text, "Google is switched on, but its key is missing.");
});

test("the wording the spec pins", () => {
  assert.equal(note("register_not_france", { area: "Andorra" }).text, "French company register not searched — Andorra is not in France.");
  assert.ok(note("capped", SAMPLE).text.includes("nearest the centre of Ariège"));
  assert.equal(
    note("capped", SAMPLE).text,
    "Showing 2,000 of about 12,000 restaurants in Ariège — the ones nearest the centre of Ariège (8 of 13 areas: Haute-Garonne, Ariège, Aude). Search a smaller area for full coverage.",
  );
  assert.equal(
    note("capped", { ...SAMPLE, expected: "" }).text,
    "Showing 2,000 restaurants in Ariège — the ones nearest the centre of Ariège (8 of 13 areas: Haute-Garonne, Ariège, Aude). Search a smaller area for full coverage.",
  );
  assert.equal(note("register_failed", { reason: "was busy" }).text, "The French company register could not be searched (it was busy). Businesses found on the map are shown without register details.");
  assert.equal(note("time_limit", { minutes: 10, done: 3, total: 13 }).text, "The search stopped after 10 minutes (3 of 13 areas). Continue to finish it.");
});

test("helpers: en-GB numbers, six-label lists, plural trades", () => {
  assert.equal(fmtNum(12000), "12,000");
  assert.equal(fmtNum("292"), "292");
  assert.equal(listOf(["a", "b"]), "a, b");
  assert.equal(listOf(["1", "2", "3", "4", "5", "6", "7"]), "1, 2, 3, 4, 5, 6, …");
  assert.equal(plural("Restaurant"), "restaurants");
  assert.equal(plural("Bakery"), "bakeries");
  assert.equal(plural("Bar / pub"), "bars / pubs");
  assert.equal(plural("Gym / fitness centre"), "gyms / fitness centres");
  assert.equal(plural("Beauty salon"), "beauty salons");
});
