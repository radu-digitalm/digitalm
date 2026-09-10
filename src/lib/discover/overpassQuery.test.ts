import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuery } from "./overpassQuery.ts";
import type { Category } from "../crm/types.ts";

const cat = (osm: { k: string; v: string }[]): Category => ({ key: "x", label: { fr: "x", en: "x" }, osm, naf: [], sic: [] });

test("buildQuery: one nwr clause per tag, bbox at 5 decimals, the contract's header and footer", () => {
  const q = buildQuery(cat([{ k: "amenity", v: "restaurant" }, { k: "shop", v: "bakery" }]), [42.9, 1.5, 43.0, 1.6]);
  assert.equal(q, '[out:json][timeout:25][maxsize:33554432];(nwr["amenity"="restaurant"](42.90000,1.50000,43.00000,1.60000);nwr["shop"="bakery"](42.90000,1.50000,43.00000,1.60000););out center tags 250;');
});

test("buildQuery: tags outside the allow-listed shapes are dropped, so nothing can be injected", () => {
  const q = buildQuery(
    cat([
      { k: 'amenity"]["x', v: "restaurant" },
      { k: "amenity", v: 'restaurant"](0,0,0,0);nwr["shop' },
      { k: "shop", v: "bakery;out" },
      { k: "A", v: "x" },
      { k: "contact:website", v: "yes" },
      { k: "craft", v: "carpenter" },
    ]),
    [0, 0, 1, 1],
  );
  assert.equal(q.includes('nwr["contact:website"="yes"]'), true);
  assert.equal(q.includes('nwr["craft"="carpenter"]'), true);
  assert.equal(q.includes("bakery"), false);
  assert.equal(q.includes("out;nwr"), false);
  assert.equal((q.match(/nwr\[/g) ?? []).length, 2);
});
