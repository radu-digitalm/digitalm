import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoogleSignals } from "./finderApi.ts";
import { GOOGLE_SIGNALS_MAX_AGE_DAYS, googleCandidateLine, googleCheckStatus, googleDataLine, googlePoints, googleReasonWord, googleSignalAgeDays, googleSignalWords, googleStatusFromCheck, googleStatusOfProspect, googleStatusTone, googleStatusWord } from "./googleWords.ts";
import { FORBIDDEN_TOKENS, GOOGLE_TEXT } from "./wording.ts";

const maintained: GoogleSignals = { operational: true, websiteOnListing: true, hours: true, reviews: 37, photos: 3, fetchedAt: "2026-09-12T10:00:00.000Z", attributions: [] };
const unmaintained: GoogleSignals = { operational: true, websiteOnListing: false, hours: false, reviews: 2, photos: 0, fetchedAt: "2026-09-12T10:00:00.000Z", attributions: ["Example Data Co"] };
const closed: GoogleSignals = { operational: false, websiteOnListing: false, hours: false, reviews: 0, photos: 0, fetchedAt: "2026-07-01T10:00:00.000Z", attributions: [] };

test("points follow the §4.6 table: 10 pass, 5 partial, 4 partial", () => {
  assert.equal(googlePoints(maintained), 10);
  assert.equal(googlePoints(unmaintained), 5);
  assert.equal(googlePoints(closed), 4);
  assert.equal(googleCheckStatus(maintained), "pass");
  assert.equal(googleCheckStatus({ ...maintained, photos: 0, reviews: 1 }), "partial"); // 8 → partial
  assert.equal(googleCheckStatus({ ...maintained, photos: 0 }), "pass"); // 9 → pass
});

test("status words from an audit check: status words only, never a signal", () => {
  assert.deepEqual(googleStatusFromCheck({ status: "pass", details: { listing: "found", websiteOnListing: true, reviews: 37 } }), { status: "maintained", reason: null });
  assert.deepEqual(googleStatusFromCheck({ status: "partial", details: { listing: "found" } }), { status: "unmaintained", reason: null });
  assert.deepEqual(googleStatusFromCheck({ status: "not_measured", details: { listing: "found", reason: "allowance" } }), { status: "found_no_details", reason: "allowance" });
  assert.deepEqual(googleStatusFromCheck({ status: "fail", details: { listing: "not_found" } }), { status: "not_found", reason: null });
  assert.deepEqual(googleStatusFromCheck({ status: "not_measured", details: { listing: "unverified", reason: "no_match" } }), { status: "no_match", reason: "no_match" });
  assert.deepEqual(googleStatusFromCheck({ status: "not_measured", details: { listing: "unverified", reason: "no_location" } }), { status: "no_location", reason: "no_location" });
  assert.deepEqual(googleStatusFromCheck({ status: "not_measured", details: { listing: "unverified" } }), { status: "not_checked", reason: null });
  const words = [googleStatusWord("maintained"), googleStatusWord("unmaintained"), googleStatusWord("found_no_details"), googleStatusWord("not_found"), googleStatusWord("no_match"), googleStatusWord("no_match", true), googleStatusWord("no_location"), googleStatusWord("not_checked")];
  assert.deepEqual(words, ["Listing found · looks maintained", "Listing found · looks unmaintained", "Listing found — details not checked", "No listing found", "No match found automatically — match manually or mark not found", "No match found automatically", "Not checked — no address or coordinates to match on", "Not checked yet"]);
  for (const w of words) {
    assert.ok(!/reviews|photos|opening hours|website on the listing/i.test(w), `status word carries a signal: ${w}`);
    for (const re of FORBIDDEN_TOKENS) assert.ok(!re.test(w), `${w} contains ${re}`);
  }
  assert.equal(googleReasonWord("allowance"), GOOGLE_TEXT.reasonAllowance);
  assert.equal(googleReasonWord("unavailable"), GOOGLE_TEXT.reasonUnavailable);
  assert.equal(googleReasonWord("no_match"), null);
  assert.equal(googleStatusTone("maintained"), "good");
  assert.equal(googleStatusTone("unmaintained"), "warn");
  assert.equal(googleStatusTone("not_found"), "bad");
  assert.equal(googleStatusTone("no_match"), "neutral");
});

test("status from the prospect's fields: found + signals scores, an automatic miss says so, no location is skipped", () => {
  const base = { lat: 42.96, lng: 1.6, postcode: "09000" };
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "found", googleSignals: maintained }), "maintained");
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "found", googleSignals: unmaintained }), "unmaintained");
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "found", googleSignals: null }), "found_no_details");
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "not_found", googleMatch: "manual" }), "not_found");
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "unverified", googleMatch: "auto", googleCheckedAt: "2026-09-12 10:00:00" }), "no_match");
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "unverified" }), "not_checked");
  assert.equal(googleStatusOfProspect({ lat: null, lng: null, postcode: null, googleListing: "unverified" }), "no_location");
  assert.equal(googleStatusOfProspect({ lat: null, lng: null, postcode: "09000", googleListing: "unverified" }), "not_checked");
  assert.equal(googleStatusOfProspect({ ...base, googleListing: "unverified" }, "no_match"), "no_match");
});

test("signal words are words, with counts; the data line names the providers", () => {
  assert.deepEqual(googleSignalWords(maintained), ["open according to Google", "website on the listing", "opening hours filled in", "37 reviews", "3 photos"]);
  assert.deepEqual(googleSignalWords(unmaintained), ["open according to Google", "no website on the listing", "no opening hours", "2 reviews", "0 photos"]);
  assert.deepEqual(googleSignalWords({ ...closed, reviews: 1, photos: 1 }), ["marked closed on Google", "no website on the listing", "no opening hours", "1 review", "1 photo"]);
  assert.equal(googleSignalWords({ ...maintained, operational: null }).length, 4);
  assert.equal(googleDataLine(["Example Data Co", " Other Co "]), "Data: Example Data Co · Other Co");
  assert.equal(googleDataLine([]), "");
  assert.equal(googleDataLine(null), "");
  for (const w of [...googleSignalWords(maintained), googleDataLine(["A"])]) for (const re of FORBIDDEN_TOKENS) assert.ok(!re.test(w), `${w} contains ${re}`);
});

test("signal age in whole days; 30 days is the refresh line", () => {
  const now = Date.parse("2026-09-12T12:00:00.000Z");
  assert.equal(googleSignalAgeDays("2026-09-12T10:00:00.000Z", now), 0);
  assert.equal(googleSignalAgeDays("2026-07-29T12:00:00.000Z", now), 45);
  assert.equal(googleSignalAgeDays(null, now), null);
  assert.equal(googleSignalAgeDays("garbage", now), null);
  assert.equal(GOOGLE_SIGNALS_MAX_AGE_DAYS, 30);
});

test("candidate lines: name — address · distance; distance left out when unknown", () => {
  assert.equal(googleCandidateLine({ name: "Le Phoebus", addressLine: "3 Cours Irénée Cros", distanceM: 40.4 }), "Le Phoebus — 3 Cours Irénée Cros · 40 m");
  assert.equal(googleCandidateLine({ name: "Le Phoebus", addressLine: "3 Cours Irénée Cros", distanceM: null }), "Le Phoebus — 3 Cours Irénée Cros");
  assert.equal(googleCandidateLine({ name: "Le Phoebus", addressLine: "", distanceM: 1234 }), "Le Phoebus · 1,234 m");
  assert.equal(googleCandidateLine({ name: "Le Phoebus", addressLine: "", distanceM: null }), "Le Phoebus");
});
