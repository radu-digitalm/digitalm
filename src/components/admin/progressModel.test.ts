import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SearchResultV2 } from "../../lib/crm/types.ts";
import { BAR, doneText, durationText, etaSeconds, progressFraction, readFromCacheAt, resolvedText, runningText, softUnitSeconds } from "./progressModel.ts";

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

test("the finished line explains a drop in the total and replaces a 0 s duration for cached results", () => {
  const done = { ...sample.done, sources: ["osm", "fr_register"] as SearchResultV2["sources"], notes: [{ code: "duplicates_removed", text: "15 duplicates removed — …", params: { n: 15 } }] };
  const line = doneText(done, new Date(Date.parse(done.createdAt) + 60_000));
  assert.match(line, /in both · 15 duplicates removed · /);
  // Rows read an hour before the search started → the cache answered.
  const created = "2026-09-12T12:00:00.000Z";
  const cached: SearchResultV2 = { ...sample.done, createdAt: created, durationMs: 0, rows: sample.done.rows.map((r) => ({ ...r, readAt: "2026-09-12T11:00:00.000Z" })) };
  assert.equal(readFromCacheAt(cached), "2026-09-12T11:00:00.000Z");
  assert.equal(durationText(cached, new Date("2026-09-12T12:12:00.000Z")), "map read 1 h ago (kept 24 hours)");
  // Register rows are read afresh every time: they never hide a cached map.
  const mixed: SearchResultV2 = { ...cached, rows: [...cached.rows, { ...cached.rows[0]!, key: "fr_register:x", sources: ["fr_register"], readAt: "2026-09-12T12:00:30.000Z" }] };
  assert.equal(readFromCacheAt(mixed), "2026-09-12T11:00:00.000Z");
  assert.ok(!/0 s\.$/.test(doneText(cached, new Date("2026-09-12T12:12:00.000Z"))));
  const fresh: SearchResultV2 = { ...sample.done, createdAt: created, durationMs: 48_000, rows: sample.done.rows.map((r) => ({ ...r, readAt: "2026-09-12T12:00:20.000Z" })) };
  assert.equal(readFromCacheAt(fresh), null);
  assert.equal(durationText(fresh), "48 s");
});

test("the resolved line drops the country when it is the area itself", () => {
  assert.equal(resolvedText({ label: "Ariège", kind: "department", countryName: "France", countryCode: "FR" }, "department"), "Ariège — department, France");
  assert.equal(resolvedText({ label: "Andorra", kind: "country", countryName: "Andorra", countryCode: "AD" }, "country"), "Andorra — country");
});
