import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, allowedKey } from "./allowlist.ts";

const SORTS: Record<string, string> = { saved: "prospects.saved_at", score: "prospects.latest_score" };

test("allowed: own keys resolve, inherited object keys fall back to the default", () => {
  assert.equal(allowed(SORTS, "score", "saved"), "prospects.latest_score");
  assert.equal(allowed(SORTS, "saved", "saved"), "prospects.saved_at");
  for (const bad of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "prototype", "", "nope", undefined, null]) {
    assert.equal(allowed(SORTS, bad, "saved"), "prospects.saved_at", `sort=${String(bad)}`);
    assert.equal(allowedKey(SORTS, bad, "saved"), "saved", `key=${String(bad)}`);
  }
  assert.equal(allowedKey(SORTS, "score", "saved"), "score");
});
