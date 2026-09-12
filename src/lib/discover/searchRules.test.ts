import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SearchResultV2 } from "../crm/types.ts";
import { RULES_VERSION, applyRules, diffusionBySiret, needsRepair } from "./searchRules.ts";

const here = new URL(".", import.meta.url).pathname;
const sample = JSON.parse(readFileSync(`${here}fixtures/search-ariege.sample.json`, "utf8")) as { done: SearchResultV2 };

/** A finished result with two register rows wrongly read as hidden (the old "diffusible" comparison) and one map-only row. */
function stale(): SearchResultV2 {
  const base = sample.done;
  const row = base.rows[0]!;
  return {
    ...base,
    rulesVersion: undefined,
    rows: [
      { ...row, key: "fr_register:11111111100011", sources: ["fr_register"], registerId: "11111111100011", diffusion: "partial" },
      { ...row, key: "osm:node/1", sources: ["osm", "fr_register"], registerId: "22222222200022", diffusion: "partial" },
      { ...row, key: "osm:node/2", sources: ["osm"], registerId: undefined, diffusion: undefined },
    ],
  };
}

const pages = [
  {
    results: [
      { siren: "111111111", statut_diffusion: "O", siege: { siret: "11111111100011", statut_diffusion_etablissement: "O" }, matching_etablissements: [] },
      { siren: "222222222", statut_diffusion: "O", siege: null, matching_etablissements: [{ siret: "22222222200022" }, { siret: "22222222200030", statut_diffusion_etablissement: "P" }] },
    ],
  },
];

test("diffusionBySiret reads every establishment of every cached page with the letter codes", () => {
  const map = diffusionBySiret(pages);
  assert.equal(map.get("11111111100011"), "full");
  assert.equal(map.get("22222222200022"), "full");
  assert.equal(map.get("22222222200030"), "partial");
  assert.equal(map.size, 3);
});

test("applyRules re-derives the register rows of an older result and marks it current", () => {
  const r = stale();
  assert.equal(needsRepair(r), true);
  const out = applyRules(r, () => diffusionBySiret(pages));
  assert.deepEqual(out, { changed: true, complete: true });
  assert.equal(r.rows[0]!.diffusion, "full");
  assert.equal(r.rows[1]!.diffusion, "full");
  assert.equal(r.rows[2]!.diffusion, undefined);
  assert.equal(r.rulesVersion, RULES_VERSION);
  assert.equal(needsRepair(r), false);
  // a current result is left alone
  assert.deepEqual(applyRules(r, () => new Map()), { changed: false, complete: true });
});

test("applyRules keeps trying while a register row is not in the cached pages; no pages at all ends the attempt", () => {
  const r = stale();
  const out = applyRules(r, () => diffusionBySiret([{ results: pages[0]!.results.slice(0, 1) }]));
  assert.deepEqual(out, { changed: true, complete: false });
  assert.equal(r.rows[0]!.diffusion, "full");
  assert.equal(r.rows[1]!.diffusion, "partial");
  assert.equal(r.rulesVersion, undefined);
  const none = stale();
  assert.deepEqual(applyRules(none, () => null), { changed: true, complete: true });
  assert.equal(none.rows[0]!.diffusion, "partial");
  assert.equal(none.rulesVersion, RULES_VERSION);
});
