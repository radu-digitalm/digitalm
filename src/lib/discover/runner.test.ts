import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, etaSeconds, initialProgress, isInterrupted, legacyStatus, resolveStatus } from "./progress.ts";

const t0 = "2026-09-12T10:00:00.000Z";
const at = (s: number) => new Date(Date.parse(t0) + s * 1000).toISOString();
const units = [
  { id: "r1", label: "Tarn", code: "81", center: { lat: 43.79, lng: 2.17 } },
  { id: "r2", label: "Aveyron", code: "12", center: { lat: 44.28, lng: 2.68 } },
  { id: "r3", label: "Ariège", code: "09", center: { lat: 42.95, lng: 1.41 } },
];

test("initial progress: running, stage osm, every unit pending, rowsVersion 0", () => {
  const p = initialProgress({ units, expected: 12000, cap: 2000, at: t0 });
  assert.equal(p.status, "running");
  assert.equal(p.stage, "osm");
  assert.deepEqual(
    p.units.map((u) => u.state),
    ["pending", "pending", "pending"],
  );
  assert.equal(p.units[0]!.code, "81");
  assert.equal(p.rowsVersion, 0);
  assert.equal(p.etaSeconds, null);
  assert.equal(p.finishedAt, null);
});

test("unit done / failed / retry / skipped update the unit, the timestamp and (after two units) the ETA", () => {
  let p = initialProgress({ units, expected: 12000, cap: 2000, at: t0 });
  const before = p;
  p = applyEvent(p, { type: "unit_start", id: "r1", at: at(1) });
  assert.equal(p.units[0]!.state, "running");
  assert.equal(before.units[0]!.state, "pending"); // immutable
  p = applyEvent(p, { type: "retrying", until: at(21), at: at(1) });
  assert.equal(p.retryingUntil, at(21));
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 400, at: at(10) });
  assert.equal(p.units[0]!.state, "done");
  assert.equal(p.units[0]!.found, 400);
  assert.equal(p.retryingUntil, null);
  assert.equal(p.etaSeconds, null); // one unit only
  p = applyEvent(p, { type: "unit_failed", id: "r2", error: "busy", at: at(20) });
  assert.equal(p.units[1]!.state, "failed");
  assert.equal(p.units[1]!.error, "busy");
  assert.equal(p.etaSeconds, 10); // 2 done in 20 s → 10 s each × 1 left
  assert.equal(p.updatedAt, at(20));
  p = applyEvent(p, { type: "unit_done", id: "r3", found: 5000, truncated: true, at: at(30) });
  assert.equal(p.units[2]!.truncated, true);
  assert.equal(etaSeconds(p, at(30)), 0);
  const skipped = applyEvent(initialProgress({ units, expected: null, cap: 2000, at: t0 }), { type: "unit_skipped", id: "r3", at: at(1) });
  assert.equal(skipped.units[2]!.state, "skipped");
});

test("register scopes and pages; merge bumps rowsVersion; finished stamps the status", () => {
  let p = initialProgress({ units: units.slice(0, 1), expected: 292, cap: 2000, at: t0 });
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 289, at: at(5) });
  p = applyEvent(p, { type: "found", found: 289, at: at(5) });
  p = applyEvent(p, { type: "stage", stage: "register", at: at(6) });
  p = applyEvent(p, { type: "scopes", scopes: [{ id: "dep:09", label: "Ariège (09)" }], at: at(6) });
  p = applyEvent(p, { type: "scope_start", id: "dep:09", at: at(6) });
  p = applyEvent(p, { type: "scope_page", id: "dep:09", pages: 7, totalPages: 18, found: 175, at: at(9) });
  assert.deepEqual(p.registerScopes[0], { id: "dep:09", label: "Ariège (09)", state: "running", pages: 7, totalPages: 18, found: 175 });
  p = applyEvent(p, { type: "scope_done", id: "dep:09", at: at(12) });
  assert.equal(p.registerScopes[0]!.state, "done");
  assert.equal(p.rowsVersion, 0);
  p = applyEvent(p, { type: "merged", found: 640, at: at(13) });
  assert.equal(p.rowsVersion, 1);
  assert.equal(p.stage, "merge");
  assert.equal(p.found, 640);
  p = applyEvent(p, { type: "finished", status: resolveStatus(p), at: at(14) });
  assert.equal(p.status, "done");
  assert.equal(p.stage, "finished");
  assert.equal(p.finishedAt, at(14));
  assert.equal(p.etaSeconds, null);
});

test("status resolution: capped vs partial vs done vs failed vs cancelled", () => {
  const fresh = () => initialProgress({ units, expected: 12000, cap: 2000, at: t0 });
  let p = fresh();
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 2000, at: at(1) });
  p = applyEvent(p, { type: "unit_skipped", id: "r2", at: at(1) });
  p = applyEvent(p, { type: "unit_skipped", id: "r3", at: at(1) });
  assert.equal(resolveStatus(p, { capped: true }), "capped");
  assert.equal(resolveStatus(p), "done");

  p = fresh();
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 10, at: at(1) });
  p = applyEvent(p, { type: "unit_failed", id: "r2", error: "timeout", at: at(2) });
  p = applyEvent(p, { type: "unit_done", id: "r3", found: 10, at: at(3) });
  assert.equal(resolveStatus(p), "partial");
  assert.equal(resolveStatus(p, { cancelled: true }), "cancelled");
  assert.equal(resolveStatus(p, { timeLimit: true }), "partial");

  p = fresh();
  p = applyEvent(p, { type: "unit_failed", id: "r1", error: "network", at: at(1) });
  assert.equal(resolveStatus(p), "failed");

  p = fresh();
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 3, at: at(1) });
  p = applyEvent(p, { type: "unit_done", id: "r2", found: 3, at: at(2) });
  p = applyEvent(p, { type: "unit_done", id: "r3", found: 3, at: at(3) });
  p = applyEvent(p, { type: "scopes", scopes: [{ id: "dep:09", label: "Ariège (09)" }], at: at(4) });
  p = applyEvent(p, { type: "scope_failed", id: "dep:09", at: at(5) });
  assert.equal(resolveStatus(p), "partial"); // a failed register scope makes the search partial
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 3, at: at(1) });
  assert.equal(resolveStatus(p, { timeLimit: true }), "partial");
});

test("cancel keeps found rows; resume re-runs only what is not done; interrupted after 90 s without a controller", () => {
  let p = initialProgress({ units, expected: 12000, cap: 2000, at: t0 });
  p = applyEvent(p, { type: "unit_done", id: "r1", found: 400, at: at(10) });
  p = applyEvent(p, { type: "found", found: 400, at: at(10) });
  p = applyEvent(p, { type: "unit_start", id: "r2", at: at(11) });
  p = applyEvent(p, { type: "finished", status: "cancelled", at: at(12) });
  assert.equal(p.status, "cancelled");
  assert.equal(p.found, 400);
  assert.equal(p.units[1]!.state, "pending"); // the interrupted unit's page is discarded
  const resumed = applyEvent(p, { type: "resumed", at: at(60) });
  assert.equal(resumed.status, "running");
  assert.equal(resumed.rowsVersion, p.rowsVersion + 1); // the list is replaced → clients refetch from 0
  assert.deepEqual(
    resumed.units.map((u) => u.state),
    ["done", "pending", "pending"],
  );
  assert.equal(resumed.startedAt, at(60));

  const running = initialProgress({ units, expected: null, cap: 2000, at: t0 });
  const now = Date.parse(t0) + 91_000;
  assert.equal(isInterrupted(running, false, now), true);
  assert.equal(isInterrupted(running, true, now), false);
  assert.equal(isInterrupted(running, false, Date.parse(t0) + 30_000), false);
  assert.equal(isInterrupted({ ...running, status: "done" }, false, now), false);
  const beating = applyEvent(running, { type: "heartbeat", at: new Date(now - 1000).toISOString() });
  assert.equal(isInterrupted(beating, false, now), false);

  assert.equal(legacyStatus(null, 0), "done");
  assert.equal(legacyStatus(null, 1), "partial");
  assert.equal(legacyStatus("capped", 0), "capped");
  assert.equal(legacyStatus("junk", 1), "partial");
});
