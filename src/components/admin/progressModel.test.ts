import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SearchResultV2 } from "../../lib/crm/types.ts";
import { BAR, doneText, etaSeconds, progressFraction, readFromCacheAt, resolvedText, resultsFromText, runningText, softUnitSeconds, summaryText, tradePlural } from "./progressModel.ts";

const here = new URL(".", import.meta.url).pathname;
const sample = JSON.parse(readFileSync(`${here}../../lib/discover/fixtures/search-ariege.sample.json`, "utf8")) as { running: SearchResultV2; done: SearchResultV2 };

const t0 = "2026-09-12T10:00:00.000Z";
const ms = (s: number) => Date.parse(t0) + s * 1000;

function single(over: Partial<SearchResultV2["progress"]> = {}, extra: Partial<SearchResultV2> = {}): SearchResultV2 {
  const base = sample.running;
  return {
    ...base,
    sources: ["osm", "fr_register"],
    rows: [],
    notes: [],
    ...extra,
    progress: {
      ...base.progress,
      status: "running",
      stage: "osm",
      units: [{ id: "r7439", label: "Ariège", center: { lat: 42.9455, lng: 1.4066 }, state: "running", found: 0 }],
      registerScopes: [],
      found: 0,
      expected: 292,
      retryingUntil: null,
      etaSeconds: null,
      startedAt: t0,
      updatedAt: t0,
      finishedAt: null,
      ...over,
    },
  };
}

test("a single area never shows a full bar while running: it moves with time against the soft estimate", () => {
  const r = single();
  const at0 = progressFraction(r, ms(0))!;
  const at10 = progressFraction(r, ms(10))!;
  const at60 = progressFraction(r, ms(60))!;
  assert.ok(at0 >= BAR.start && at0 < 0.1, `starts near the left: ${at0}`);
  assert.ok(at10 > at0, "grows with time");
  assert.ok(at60 > at10 && at60 < BAR.osmEndWithRegister, `stays inside the map phase's share: ${at60}`);
  // Register stage: between the map phase's end and 88 %.
  const reg = single({ stage: "register", units: [{ id: "r7439", label: "Ariège", center: { lat: 42.9, lng: 1.4 }, state: "done", found: 289 }], registerScopes: [{ id: "dep:09", label: "Ariège (09)", state: "running", pages: 9, totalPages: 18, found: 100 }] });
  const f = progressFraction(reg, ms(30))!;
  assert.ok(f > BAR.osmEndWithRegister && f < BAR.registerEnd, `register share: ${f}`);
  // Placing: 95 %, never 1.
  const merge = single({ stage: "merge" });
  assert.equal(progressFraction(merge, ms(40)), BAR.placing);
  assert.equal(progressFraction({ ...merge, progress: { ...merge.progress, status: "done", stage: "finished" } }, ms(50)), 1);
});

test("without a register the map phase owns more of the bar; multi-unit runs step by unit", () => {
  const r = single({}, { sources: ["osm"], area: { ...sample.running.area, countryCode: "AD", countryName: "Andorra" } });
  const f = progressFraction(r, ms(200))!;
  assert.ok(f > BAR.osmEndWithRegister && f < BAR.osmEndAlone, `map-only share: ${f}`);
  const multi = single({
    expected: 12000,
    units: [
      { id: "a", label: "A", center: { lat: 0, lng: 0 }, state: "done", found: 100 },
      { id: "b", label: "B", center: { lat: 0, lng: 0 }, state: "running", found: 0 },
      { id: "c", label: "C", center: { lat: 0, lng: 0 }, state: "pending", found: 0 },
      { id: "d", label: "D", center: { lat: 0, lng: 0 }, state: "pending", found: 0 },
    ],
  });
  const step = progressFraction(multi, ms(5))!;
  assert.ok(Math.abs(step - (BAR.start + 0.25 * (BAR.osmEndWithRegister - BAR.start))) < 0.02, `one of four: ${step}`);
});

test("soft ETA for one area from the expected count; the multi-unit ETA comes from the server", () => {
  assert.equal(softUnitSeconds(292), 8 + 292 * 0.06);
  assert.equal(softUnitSeconds(0), 10);
  assert.equal(softUnitSeconds(100000), 120);
  assert.equal(softUnitSeconds(null), null);
  const r = single();
  assert.equal(etaSeconds(r, ms(5)), Math.round(8 + 292 * 0.06 - 5));
  assert.equal(etaSeconds(r, ms(60)), null);
  const multi = single({ etaSeconds: 40, units: [{ id: "a", label: "A", center: { lat: 0, lng: 0 }, state: "done", found: 1 }, { id: "b", label: "B", center: { lat: 0, lng: 0 }, state: "pending", found: 0 }] });
  assert.equal(etaSeconds(multi, ms(5)), 40);
});

test("the running sentence says the stage, the elapsed time, and never '0 so far' for a single area", () => {
  const r = single();
  const early = runningText(r, ms(12));
  assert.match(early, /^Searching OpenStreetMap · about \d+ s left · searching for 12 s$/);
  assert.ok(!/0 businesses so far/.test(early));
  const late = runningText(r, ms(90));
  assert.match(late, /taking longer than usual · searching for 1 min 30 s$/);
  const found = runningText(single({ found: 231 }), ms(20));
  assert.match(found, /231 businesses so far/);
  const merge = runningText(single({ stage: "merge" }), ms(33));
  assert.equal(merge, "Placing on the map and removing duplicates… · searching for 33 s");
  const retry = runningText(single({ retryingUntil: new Date(ms(31)).toISOString() }), ms(12));
  assert.equal(retry, "The map service is busy — retrying in 19 s");
  const reg = runningText(single({ stage: "register", registerScopes: [{ id: "dep:09", label: "Ariège (09)", state: "running", pages: 7, totalPages: 18, found: 100 }] }), ms(40));
  assert.match(reg, /^Checking the French company register — 7 of 18 pages · about \d+ s left · searching for 40 s$/);
});

test("the finished line is the count with the trade; the sources split and the duplicates stay out of it", () => {
  const done = { ...sample.done, sources: ["osm", "fr_register"] as SearchResultV2["sources"], notes: [{ code: "duplicates_removed", text: "15 duplicates removed — …", params: { n: 15 } }] };
  assert.equal(doneText(done), "572 restaurants");
  assert.equal(doneText({ ...done, total: 1 }), "1 restaurant");
  assert.equal(summaryText(done), "572 restaurants in Ariège");
  assert.equal(summaryText({ ...done, total: 1 }), "1 restaurant in Ariège");
  assert.equal(tradePlural("Bar / pub"), "bars / pubs");
  assert.equal(tradePlural("Bakery"), "bakeries");
  assert.equal(tradePlural("Bakery", 1), "bakery");
  assert.equal(tradePlural("Beauty salon and spa"), "beauty salons and spas");
});

test("freshness is a sentence only after a minute, dated from the map read when the 24 h cache answered", () => {
  // Rows read an hour before the search started → the cache answered.
  const created = "2026-09-12T12:00:00.000Z";
  const cached: SearchResultV2 = { ...sample.done, createdAt: created, durationMs: 0, rows: sample.done.rows.map((r) => ({ ...r, readAt: "2026-09-12T11:00:00.000Z" })) };
  assert.equal(readFromCacheAt(cached), "2026-09-12T11:00:00.000Z");
  assert.equal(resultsFromText(cached, new Date("2026-09-12T12:12:00.000Z")), "Results from 1 h ago");
  // Register rows are read afresh every time: they never hide a cached map.
  const mixed: SearchResultV2 = { ...cached, rows: [...cached.rows, { ...cached.rows[0]!, key: "fr_register:x", sources: ["fr_register"], readAt: "2026-09-12T12:00:30.000Z" }] };
  assert.equal(readFromCacheAt(mixed), "2026-09-12T11:00:00.000Z");
  // A fresh run says nothing for its first minute, then dates from the run itself.
  const fresh: SearchResultV2 = { ...sample.done, createdAt: created, durationMs: 48_000, rows: sample.done.rows.map((r) => ({ ...r, readAt: "2026-09-12T12:00:20.000Z" })) };
  assert.equal(readFromCacheAt(fresh), null);
  assert.equal(resultsFromText(fresh, new Date("2026-09-12T12:00:48.000Z")), "");
  assert.equal(resultsFromText(fresh, new Date("2026-09-12T14:30:00.000Z")), "Results from 2 h ago");
  assert.equal(resultsFromText(fresh, new Date("2026-09-14T14:30:00.000Z")), "Results from 12 Sep, 14:00");
});

test("the resolved line drops the country when it is the area itself", () => {
  assert.equal(resolvedText({ label: "Ariège", kind: "department", countryName: "France", countryCode: "FR" }, "department"), "Ariège — department, France");
  assert.equal(resolvedText({ label: "Andorra", kind: "country", countryName: "Andorra", countryCode: "AD" }, "country"), "Andorra — country");
});

test("the Google phase (finder-google §5.4) takes the gap before placing and says which part it is on; nothing changes without it", () => {
  const google = { state: "running" as const, tiles: 9, tilesDone: 6, requests: 12, found: 80, matched: 50, only: 23, dropped: 7, pinsVersion: 0 };
  const r = single({ stage: "google" as SearchResultV2["progress"]["stage"], google, units: [{ id: "r7439", label: "Ariège", center: { lat: 42.9, lng: 1.4 }, state: "done", found: 289 }], registerScopes: [{ id: "dep:09", label: "Ariège (09)", state: "done", pages: 18, totalPages: 18, found: 372 }] });
  const f6 = progressFraction(r, ms(40))!;
  assert.ok(f6 > BAR.registerEnd && f6 < BAR.placing, `Google share sits between the register's end and placing: ${f6}`);
  const f2 = progressFraction({ ...r, progress: { ...r.progress, google: { ...google, tilesDone: 2 } } }, ms(40))!;
  assert.ok(f2 < f6 && f2 >= BAR.registerEnd, `fills part by part: ${f2} < ${f6}`);
  assert.equal(runningText(r, ms(40)), "Asking Google — 6 of 9 parts of Ariège · searching for 40 s");
  assert.equal(etaSeconds(r, ms(40)), null);
  // Without a register the share starts at the map phase's end.
  const alone = { ...r, sources: ["osm", "google"] as SearchResultV2["sources"], area: { ...r.area, countryCode: "AD", countryName: "Andorra" } };
  const fa = progressFraction(alone, ms(40))!;
  assert.ok(fa > BAR.osmEndAlone && fa < BAR.placing, `map-only share: ${fa}`);
  // The plain result knows nothing of Google: the same numbers as before.
  const plain = single({ stage: "merge" });
  assert.equal(progressFraction(plain, ms(40)), BAR.placing);
  assert.equal(runningText(plain, ms(33)), "Placing on the map and removing duplicates… · searching for 33 s");
});
