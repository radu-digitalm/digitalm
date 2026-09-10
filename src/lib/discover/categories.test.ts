import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, NAF_RE, OSM_KEYS, SIC_RE, categoryByKey, customCategory, customKey, parseCategory, tradeKeyFor, tradeLabel } from "./categories.ts";

test("19 fixed categories, unique keys, every one with OSM + NAF + SIC", () => {
  assert.equal(CATEGORIES.length, 19);
  assert.equal(new Set(CATEGORIES.map((c) => c.key)).size, 19);
  for (const c of CATEGORIES) {
    assert.ok(c.osm.length >= 1, c.key);
    assert.ok(c.naf.length >= 1 && c.naf.every((n) => NAF_RE.test(n)), `${c.key} naf ${c.naf}`);
    assert.ok(c.sic.length >= 1 && c.sic.every((s) => SIC_RE.test(s)), `${c.key} sic ${c.sic}`);
    assert.ok(c.osm.every((t) => (OSM_KEYS as readonly string[]).includes(t.k)), `${c.key} osm key`);
    assert.ok(c.label.fr && c.label.en);
    assert.equal(c.custom, undefined);
  }
});

test("mapping matches the contract table (spot checks)", () => {
  assert.deepEqual(categoryByKey("restaurant")?.osm, [{ k: "amenity", v: "restaurant" }]);
  assert.deepEqual(categoryByKey("restaurant")?.naf, ["56.10A"]);
  assert.deepEqual(categoryByKey("restaurant")?.sic, ["56101"]);
  assert.deepEqual(categoryByKey("bar")?.osm, [{ k: "amenity", v: "bar" }, { k: "amenity", v: "pub" }]);
  assert.deepEqual(categoryByKey("bakery")?.naf, ["10.71C"]);
  assert.deepEqual(categoryByKey("bakery")?.sic, ["10710", "47240"]);
  assert.deepEqual(categoryByKey("joiner")?.osm, [{ k: "craft", v: "carpenter" }, { k: "craft", v: "joiner" }]);
  assert.deepEqual(categoryByKey("gite")?.osm, [{ k: "tourism", v: "guest_house" }, { k: "tourism", v: "chalet" }]);
  assert.deepEqual(categoryByKey("hairdresser")?.naf, ["96.02A"]);
  assert.deepEqual(categoryByKey("beauty")?.naf, ["96.02B"]);
  assert.deepEqual(categoryByKey("beauty")?.sic, ["96020"]);
  assert.deepEqual(categoryByKey("roofer")?.naf, ["43.91B"]);
  assert.deepEqual(categoryByKey("painter")?.sic, ["43341"]);
  assert.deepEqual(categoryByKey("gym")?.osm, [{ k: "leisure", v: "fitness_centre" }]);
  assert.deepEqual(categoryByKey("dentist")?.naf, ["86.23Z"]);
  assert.equal(categoryByKey("nope"), null);
});

test("custom trade: key custom:<slug>, OSM only unless codes given, validation", () => {
  const tattoo = customCategory({ osmKey: "shop", osmValue: "tattoo" });
  assert.ok(tattoo);
  assert.equal(tattoo.key, "custom:tattoo");
  assert.equal(tattoo.custom, true);
  assert.deepEqual(tattoo.osm, [{ k: "shop", v: "tattoo" }]);
  assert.deepEqual(tattoo.naf, []);
  assert.deepEqual(tattoo.sic, []);
  assert.equal(tattoo.label.en, "tattoo");
  assert.equal(tradeKeyFor(tattoo), "tattoo");

  const withCodes = customCategory({ osmKey: "craft", osmValue: "tiler", label: "Tiler", naf: "43.33z", sic: "43330" });
  assert.ok(withCodes);
  assert.deepEqual(withCodes.naf, ["43.33Z"]);
  assert.deepEqual(withCodes.sic, ["43330"]);
  assert.equal(tradeKeyFor(withCodes), "Tiler");

  assert.equal(customCategory({ osmKey: "building", osmValue: "tattoo" }), null);
  assert.equal(customCategory({ osmKey: "shop", osmValue: "t" }), null);
  assert.equal(customCategory({ osmKey: "shop", osmValue: "Tattoo Shop" }), null);
  assert.equal(customCategory({ osmKey: "shop", osmValue: "tattoo", naf: "4333" }), null);
  assert.equal(customCategory({ osmKey: "shop", osmValue: "tattoo", sic: "433" }), null);
  assert.equal(customKey("ice_cream"), "custom:ice_cream");
});

test("parseCategory accepts a fixed key, a form object or a Category-like object", () => {
  assert.equal(parseCategory("bakery")?.key, "bakery");
  assert.equal(parseCategory({ key: "bakery" })?.key, "bakery");
  assert.equal(parseCategory({ osmKey: "shop", osmValue: "tattoo" })?.key, "custom:tattoo");
  assert.equal(parseCategory({ key: "custom:tattoo", osm: [{ k: "shop", v: "tattoo" }] })?.key, "custom:tattoo");
  assert.equal(parseCategory({ key: "custom:x", osm: [{ k: "shop", v: "x" }] }), null);
  assert.equal(parseCategory(42), null);
  assert.equal(parseCategory(null), null);
  assert.equal(tradeKeyFor(parseCategory("bakery")!), "bakery");
});

test("tradeLabel: fixed keys localise, custom labels pass through", () => {
  assert.equal(tradeLabel("bakery", "fr"), "Boulangerie");
  assert.equal(tradeLabel("bakery", "en"), "Bakery");
  assert.equal(tradeLabel("Tiler"), "Tiler");
  assert.equal(tradeLabel(null), null);
});
