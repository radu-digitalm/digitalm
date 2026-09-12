import { test } from "node:test";
import assert from "node:assert/strict";
import { AREA_OFFSET, AreaQueryError, areaIdOf, childrenQuery, communesQuery, containingCommuneQuery, countQuery, selectorStatement, tagClauses, unitQuery } from "./areaQuery.ts";
import type { AreaSelector, Category } from "../crm/types.ts";

const cat = (osm: { k: string; v: string }[]): Pick<Category, "osm"> => ({ osm });
const restaurant = cat([{ k: "amenity", v: "restaurant" }]);
const rel: AreaSelector = { kind: "relation", relId: 7439 };

test("relation selector: area id is 3,600,000,000 + relation id (3.6e9, not 3.6e10)", () => {
  assert.equal(AREA_OFFSET, 3_600_000_000);
  assert.equal(areaIdOf(7439), 3_600_007_439);
  assert.equal(selectorStatement(rel), "area(3600007439)->.a;");
  assert.equal(
    unitQuery(restaurant, rel),
    '[out:json][timeout:60][maxsize:67108864];area(3600007439)->.a;(nwr["amenity"="restaurant"](area.a););out center tags 5000;',
  );
  assert.equal(countQuery(restaurant, rel), '[out:json][timeout:30];area(3600007439)->.a;(nwr["amenity"="restaurant"](area.a););out count;');
});

test("INSEE set selector: one area per code, matched as a set", () => {
  const sel: AreaSelector = { kind: "insee", codes: ["09122", "2A004", "97101"] };
  assert.equal(
    selectorStatement(sel),
    '(area["ref:INSEE"="09122"]["boundary"="administrative"];area["ref:INSEE"="2A004"]["boundary"="administrative"];area["ref:INSEE"="97101"]["boundary"="administrative"];)->.a;',
  );
  assert.ok(countQuery(restaurant, sel).includes('(nwr["amenity"="restaurant"](area.a););out count;'));
});

test("around selector: no area statement, an (around:m,lat,lon) filter instead", () => {
  const sel: AreaSelector = { kind: "around", lat: 42.9646, lng: 1.6053, m: 4000 };
  assert.equal(selectorStatement(sel), "");
  assert.equal(
    unitQuery(restaurant, sel),
    '[out:json][timeout:60][maxsize:67108864];(nwr["amenity"="restaurant"](around:4000,42.964600,1.605300););out center tags 5000;',
  );
});

test("bbox clip: the tile box follows the area filter in the same statement, 5 decimals", () => {
  const q = unitQuery(cat([{ k: "amenity", v: "bar" }, { k: "amenity", v: "pub" }]), rel, [42.9, 1.5, 43.15, 1.75]);
  assert.ok(q.includes('nwr["amenity"="bar"](area.a)(42.90000,1.50000,43.15000,1.75000);nwr["amenity"="pub"](area.a)(42.90000,1.50000,43.15000,1.75000);'));
  assert.throws(() => unitQuery(restaurant, rel, [43, 1, 42, 2]), AreaQueryError); // south ≥ north
  assert.throws(() => unitQuery(restaurant, rel, [42, 1, 43, Number.NaN]), AreaQueryError);
});

test("children / communes / containing-commune queries", () => {
  assert.equal(
    childrenQuery(rel, 6),
    '[out:json][timeout:60];area(3600007439)->.a;rel(area.a)["boundary"="administrative"]["type"="boundary"]["admin_level"="6"];out tags center;',
  );
  assert.throws(() => childrenQuery(rel, 11), AreaQueryError);
  assert.throws(() => childrenQuery({ kind: "around", lat: 1, lng: 1, m: 100 }, 8), AreaQueryError);
  assert.equal(communesQuery(rel), '[out:json][timeout:60];area(3600007439)->.a;rel["boundary"="administrative"]["admin_level"~"^[78]$"](area.a);out tags center;');
  assert.equal(
    communesQuery({ kind: "around", lat: 42.9646, lng: 1.6053, m: 4000 }),
    '[out:json][timeout:60];rel["boundary"="administrative"]["admin_level"~"^[78]$"](around:4000,42.964600,1.605300);out tags center;',
  );
  assert.equal(countQuery(restaurant, rel, 20), '[out:json][timeout:20];area(3600007439)->.a;(nwr["amenity"="restaurant"](area.a););out count;');
  assert.throws(() => countQuery(restaurant, rel, 3), AreaQueryError);
  assert.throws(() => countQuery(restaurant, rel, 2.5), AreaQueryError);
  assert.equal(containingCommuneQuery(42.9646, 1.6053), '[out:json][timeout:30];is_in(42.964600,1.605300)->.a;area.a["boundary"="administrative"]["admin_level"="8"];out tags;');
  assert.throws(() => containingCommuneQuery(91, 0), AreaQueryError);
});

test("guards: relation ids, INSEE codes, radii and tags outside the allowed shapes throw (nothing can be injected)", () => {
  for (const bad of [0, -1, 1.5, 100_000_000, Number.NaN, "7439" as unknown as number]) {
    assert.throws(() => selectorStatement({ kind: "relation", relId: bad }), AreaQueryError, `relId ${bad}`);
  }
  assert.throws(() => selectorStatement({ kind: "insee", codes: [] }), AreaQueryError);
  assert.throws(() => selectorStatement({ kind: "insee", codes: ['09122"]["x'] }), AreaQueryError);
  assert.throws(() => selectorStatement({ kind: "insee", codes: ["9122"] }), AreaQueryError);
  assert.throws(() => selectorStatement({ kind: "around", lat: 1, lng: 1, m: 20_001 }), AreaQueryError);
  assert.throws(() => selectorStatement({ kind: "around", lat: 1, lng: 1, m: 0.5 }), AreaQueryError);
  assert.throws(() => selectorStatement({ kind: "around", lat: 95, lng: 1, m: 100 }), AreaQueryError);
  assert.throws(() => selectorStatement({ kind: "bogus" } as unknown as AreaSelector), AreaQueryError);
  for (const t of [
    { k: 'amenity"]["x', v: "restaurant" },
    { k: "amenity", v: 'restaurant"](0,0,0,0);nwr["shop' },
    { k: "shop", v: "bakery;out" },
    { k: "A", v: "x" },
    { k: "shop", v: "Bakery" },
  ]) {
    assert.throws(() => tagClauses(cat([t])), AreaQueryError, JSON.stringify(t));
  }
  assert.throws(() => tagClauses(cat([])), AreaQueryError);
  assert.deepEqual(tagClauses(cat([{ k: "contact:website", v: "yes" }, { k: "craft", v: "carpenter" }])), [
    { k: "contact:website", v: "yes" },
    { k: "craft", v: "carpenter" },
  ]);
});
