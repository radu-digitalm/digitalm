import { test } from "node:test";
import assert from "node:assert/strict";
import { ageDays, applyManual, applyMatch, checkInputFor, decide, olderThanDays, reasonForError, sqlStamp, type DecideInput } from "./googleCheckRules.ts";

const NOW = new Date("2026-09-12T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const sqlDaysAgo = (n: number) => sqlStamp(new Date(NOW.getTime() - n * 86_400_000));

function input(over: Partial<DecideInput> & { prospect?: Partial<DecideInput["prospect"]> } = {}): DecideInput {
  const { prospect, ...rest } = over;
  return {
    on: true,
    prospect: { placeId: null, listing: "unverified", match: null, checkedAt: null, hasLocation: true, ...prospect },
    latestSignals: null,
    now: NOW,
    ...rest,
  };
}

test("off → passthrough whatever the row says", () => {
  assert.equal(decide(input({ on: false })), "passthrough");
  assert.equal(decide(input({ on: false, prospect: { placeId: "ChIJabcdefghijklmnop" } })), "passthrough");
});

test("no id: never checked → match; an automatic miss 10 days ago → passthrough (no request); 31 days → match", () => {
  assert.equal(decide(input()), "match");
  assert.equal(decide(input({ prospect: { match: "auto", checkedAt: sqlDaysAgo(10) } })), "passthrough");
  assert.equal(decide(input({ prospect: { match: "auto", checkedAt: sqlDaysAgo(31) } })), "match");
  assert.equal(decide(input({ prospect: { match: "auto", checkedAt: daysAgo(29) } })), "passthrough");
  assert.equal(decide(input({ prospect: { match: "auto", checkedAt: daysAgo(30) } })), "match");
});

test("manual verdicts are never re-matched; a stored not_found stays", () => {
  assert.equal(decide(input({ prospect: { match: "manual", listing: "not_found", checkedAt: sqlDaysAgo(400) } })), "passthrough");
  assert.equal(decide(input({ prospect: { match: "manual", listing: "unverified" } })), "passthrough");
  assert.equal(decide(input({ prospect: { listing: "not_found" } })), "passthrough");
});

test("neither coordinates nor a postcode → skip_no_location, nothing requested", () => {
  assert.equal(decide(input({ prospect: { hasLocation: false } })), "skip_no_location");
  assert.equal(decide(input({ prospect: { hasLocation: false, match: "auto", checkedAt: sqlDaysAgo(5) } })), "passthrough");
});

test("with an id: signals 10 days old → reuse; 31 days → signals; none → signals; fresh → signals", () => {
  const withId = { placeId: "ChIJabcdefghijklmnop", listing: "found" as const, match: "auto" as const };
  assert.equal(decide(input({ prospect: withId, latestSignals: { fetchedAt: daysAgo(10) } })), "reuse");
  assert.equal(decide(input({ prospect: withId, latestSignals: { fetchedAt: daysAgo(31) } })), "signals");
  assert.equal(decide(input({ prospect: withId, latestSignals: { fetchedAt: daysAgo(30) } })), "signals");
  assert.equal(decide(input({ prospect: withId })), "signals");
  assert.equal(decide(input({ prospect: withId, latestSignals: { fetchedAt: daysAgo(1) }, fresh: true })), "signals");
  assert.equal(decide(input({ prospect: withId, latestSignals: { fetchedAt: "garbage" } })), "signals");
});

test("olderThanDays / ageDays read SQL and ISO stamps; unreadable counts as old", () => {
  assert.equal(olderThanDays("2026-08-01 10:00:00", NOW, 30), true);
  assert.equal(olderThanDays("2026-09-01 10:00:00", NOW, 30), false);
  assert.equal(olderThanDays("2026-08-13T10:00:00.000Z", NOW, 30), true);
  assert.equal(olderThanDays("2026-08-13T10:00:01.000Z", NOW, 30), false);
  assert.equal(olderThanDays(null, NOW, 30), true);
  assert.equal(olderThanDays("nope", NOW, 30), true);
  assert.equal(ageDays(sqlDaysAgo(45), NOW), 45);
  assert.equal(ageDays(null, NOW), null);
});

test("applyMatch: a hit sets the place, the listing, the match and both stamps; a miss stamps the attempt only", () => {
  const hit = applyMatch({ hit: "ChIJabcdefghijklmnop", now: NOW });
  assert.deepEqual(hit.columns, {
    google_place_id: "ChIJabcdefghijklmnop",
    google_listing: "found",
    google_match: "auto",
    google_confirmed_at: "2026-09-12 10:00:00",
    google_checked_at: "2026-09-12 10:00:00",
  });
  const miss = applyMatch({ hit: null, now: NOW });
  assert.deepEqual(miss.columns, { google_match: "auto", google_checked_at: "2026-09-12 10:00:00" });
  assert.equal("google_listing" in miss.columns, false);
  assert.equal("google_place_id" in miss.columns, false);
});

test("applyManual: confirm / reject / clear column sets", () => {
  assert.deepEqual(applyManual("confirm", { placeId: "ChIJabcdefghijklmnop", now: NOW }).columns, {
    google_place_id: "ChIJabcdefghijklmnop",
    google_listing: "found",
    google_match: "manual",
    google_confirmed_at: "2026-09-12 10:00:00",
    google_checked_at: "2026-09-12 10:00:00",
  });
  const reject = applyManual("reject", { now: NOW }).columns;
  assert.equal(reject.google_listing, "not_found");
  assert.equal(reject.google_match, "manual");
  assert.equal(reject.google_place_id, null);
  assert.equal(reject.google_checked_at, "2026-09-12 10:00:00");
  assert.deepEqual(applyManual("clear", { now: NOW }).columns, { google_place_id: null, google_listing: "unverified", google_match: null, google_confirmed_at: null, google_checked_at: null });
});

test("checkInputFor: allowance → found without signals and the reason; a miss → unverified / no_match; the decision never throws on an error code", () => {
  const withId = { placeId: "ChIJabcdefghijklmnop", listing: "found" as const, match: "auto" as const, checkedAt: null, hasLocation: true };
  const signals = { operational: true, websiteOnListing: true, hours: true, reviews: 37, photos: 3, fetchedAt: NOW.toISOString(), attributions: [] };
  assert.deepEqual(checkInputFor("signals", withId, { error: "allowance" }), { status: "found", signals: null, reason: "allowance" });
  assert.deepEqual(checkInputFor("signals", withId, { error: "busy" }), { status: "found", signals: null, reason: "unavailable" });
  assert.deepEqual(checkInputFor("signals", withId, { error: "timeout" }), { status: "found", signals: null, reason: "unavailable" });
  assert.deepEqual(checkInputFor("signals", withId, { signals }), { status: "found", signals });
  assert.deepEqual(checkInputFor("reuse", withId, { signals }), { status: "found", signals });
  const noId = { placeId: null, listing: "unverified" as const, match: null, checkedAt: null, hasLocation: true };
  assert.deepEqual(checkInputFor("match", noId, { hit: null }), { status: "unverified", signals: null, reason: "no_match" });
  assert.deepEqual(checkInputFor("match", noId, { hit: "ChIJabcdefghijklmnop", signals }), { status: "found", signals });
  assert.deepEqual(checkInputFor("match", noId, { hit: "ChIJabcdefghijklmnop", error: "allowance" }), { status: "found", signals: null, reason: "allowance" });
  assert.deepEqual(checkInputFor("match", noId, { error: "refused" }), { status: "unverified", signals: null, reason: "unavailable" });
  assert.deepEqual(checkInputFor("skip_no_location", noId), { status: "unverified", signals: null, reason: "no_location" });
  // A recent automatic miss passes through with its reason and stamp.
  const missed = { ...noId, match: "auto" as const, checkedAt: "2026-09-02 10:00:00" };
  assert.deepEqual(checkInputFor("passthrough", missed), { status: "unverified", signals: null, reason: "no_match", checkedAt: "2026-09-02 10:00:00" });
  const rejected = { ...noId, listing: "not_found" as const, match: "manual" as const, checkedAt: "2026-09-02 10:00:00" };
  assert.deepEqual(checkInputFor("passthrough", rejected), { status: "not_found", signals: null, checkedAt: "2026-09-02 10:00:00" });
  assert.deepEqual(checkInputFor("passthrough", noId), { status: "unverified", signals: null });
  for (const code of ["off", "no_key", "mask_tier", "allowance", "refused", "bad_request", "busy", "timeout", "network", "unavailable", "aborted"]) {
    assert.doesNotThrow(() => checkInputFor("signals", withId, { error: code }));
    assert.doesNotThrow(() => reasonForError(code));
  }
});
