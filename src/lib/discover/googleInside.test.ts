import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { departementsOfFrPostcode, googleInside, postcodePrefixOf, type InsideArea, type PlaceAddress } from "./googleInside.ts";
import { parseSearch } from "./googleRequests.ts";

const here = new URL(".", import.meta.url).pathname;
const page1 = parseSearch(JSON.parse(readFileSync(`${here}fixtures/google/text-search.tile1.page1.json`, "utf8")));

function addr(over: Partial<PlaceAddress> = {}): PlaceAddress {
  return { postcode: null, country: null, adminLevel1: null, adminLevel2: null, locality: null, postalTown: null, ...over };
}

const ARIEGE: InsideArea = { kind: "department", countryCode: "FR", label: "Ariège", admin: { departement: "09" } };
const OCCITANIE: InsideArea = { kind: "region", countryCode: "FR", label: "Occitanie", admin: { regionCode: "76", departements: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"] } };
const FOIX: InsideArea = { kind: "town", countryCode: "FR", label: "Foix", admin: { postcodes: ["09000"], inseeCode: "09122", departement: "09", locality: "Foix" } };
const ANDORRA: InsideArea = { kind: "country", countryCode: "AD", label: "Andorra" };
const CAMBRIDGE: InsideArea = { kind: "town", countryCode: "GB", label: "Cambridge, England", admin: { locality: "Cambridge" } };
const CAMBRIDGESHIRE: InsideArea = { kind: "department", countryCode: "GB", label: "Cambridgeshire" };
const CIRCLE: InsideArea = { kind: "place", countryCode: "FR", label: "within 4 km of Foix", admin: { locality: "Foix" } };

test("department 09: postcode 09000 yes, 66500 no, Andorra no, nothing → approx, Corsica 2A → prefix 20", () => {
  assert.equal(googleInside(addr({ country: "FR", postcode: "09000" }), ARIEGE), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "09 000" }), ARIEGE), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "66500", adminLevel2: "Pyrénées-Orientales" }), ARIEGE), "no");
  assert.equal(googleInside(addr({ country: "AD", postcode: "AD400" }), ARIEGE), "no");
  assert.equal(googleInside(addr(), ARIEGE), "approx");
  assert.equal(googleInside(addr({ country: "FR" }), ARIEGE), "approx");
  // No postcode but the department name agrees / disagrees.
  assert.equal(googleInside(addr({ country: "FR", adminLevel2: "Ariège" }), ARIEGE), "yes");
  assert.equal(googleInside(addr({ country: "FR", adminLevel2: "ariege" }), ARIEGE), "yes");
  assert.equal(googleInside(addr({ country: "FR", adminLevel2: "Aude" }), ARIEGE), "no");
  assert.equal(postcodePrefixOf("2A"), "20");
  assert.equal(postcodePrefixOf("2B"), "20");
  assert.equal(postcodePrefixOf("971"), "971");
  const corse: InsideArea = { kind: "department", countryCode: "FR", label: "Corse-du-Sud", admin: { departement: "2A" } };
  assert.equal(googleInside(addr({ country: "FR", postcode: "20000" }), corse), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "09000" }), corse), "no");
  assert.deepEqual(departementsOfFrPostcode("20000"), ["2A", "2B"]);
  assert.deepEqual(departementsOfFrPostcode("97100"), ["971"]);
  assert.deepEqual(departementsOfFrPostcode("AD400"), []);
});

test("the tile-1 fixture: 17 rows yes, the Andorra row no, the 66 row no, the bare row approx", () => {
  const verdicts = page1.places.map((p) => googleInside(p, ARIEGE));
  assert.equal(verdicts.filter((v) => v === "yes").length, 17);
  assert.equal(verdicts[17], "no"); // La Massana, AD
  assert.equal(verdicts[18], "no"); // Formiguères, 66210
  assert.equal(verdicts[19], "approx"); // no address components at all
});

test("region Occitanie: the region name or a postcode of one of its departments", () => {
  assert.equal(googleInside(addr({ country: "FR", adminLevel1: "Occitanie" }), OCCITANIE), "yes");
  assert.equal(googleInside(addr({ country: "FR", adminLevel1: "Nouvelle-Aquitaine" }), OCCITANIE), "no");
  assert.equal(googleInside(addr({ country: "FR", postcode: "31000" }), OCCITANIE), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "33000", adminLevel1: "Nouvelle-Aquitaine" }), OCCITANIE), "no");
  assert.equal(googleInside(addr({ country: "FR" }), OCCITANIE), "approx");
});

test("town Foix: its postcode set or its locality", () => {
  assert.equal(googleInside(addr({ country: "FR", postcode: "09000", locality: "Foix" }), FOIX), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "09000" }), FOIX), "yes");
  assert.equal(googleInside(addr({ country: "FR", locality: "FOIX" }), FOIX), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "09100", locality: "Pamiers" }), FOIX), "no");
  assert.equal(googleInside(addr({ country: "FR", locality: "Pamiers" }), FOIX), "no");
  assert.equal(googleInside(addr({ country: "FR" }), FOIX), "approx");
  // A hamlet named as the locality but with the town's postcode still counts.
  assert.equal(googleInside(addr({ country: "FR", postcode: "09000", locality: "Ferrières-sur-Ariège" }), FOIX), "yes");
  const postcodeArea: InsideArea = { kind: "postcode", countryCode: "FR", label: "09120 — Varilhes and 16 more communes", admin: { postcodes: ["09120"], locality: "Varilhes" } };
  assert.equal(googleInside(addr({ country: "FR", postcode: "09120", locality: "Rieux-de-Pelleport" }), postcodeArea), "yes");
  assert.equal(googleInside(addr({ country: "FR", locality: "Varilhes" }), postcodeArea), "yes");
  assert.equal(googleInside(addr({ country: "FR", postcode: "09000" }), postcodeArea), "no");
});

test("country Andorra: yes for Andorran addresses, no for others; a circle is always yes", () => {
  assert.equal(googleInside(addr({ country: "AD" }), ANDORRA), "yes");
  assert.equal(googleInside(addr(), ANDORRA), "yes");
  assert.equal(googleInside(addr({ country: "FR" }), ANDORRA), "no");
  assert.equal(googleInside(addr({ country: "FR", postcode: "31000" }), CIRCLE), "yes");
  assert.equal(googleInside(addr({ country: "ES" }), CIRCLE), "no");
});

test("outside France: Cambridge by locality, Cambridgeshire by administrative_area_level_2 — accent- and case-insensitive", () => {
  assert.equal(googleInside(addr({ country: "GB", locality: "Cambridge" }), CAMBRIDGE), "yes");
  assert.equal(googleInside(addr({ country: "GB", postalTown: "Cambridge" }), CAMBRIDGE), "yes");
  assert.equal(googleInside(addr({ country: "GB", locality: "Ely" }), CAMBRIDGE), "no");
  assert.equal(googleInside(addr({ country: "GB" }), CAMBRIDGE), "approx");
  assert.equal(googleInside(addr({ country: "GB", adminLevel2: "Cambridgeshire" }), CAMBRIDGESHIRE), "yes");
  assert.equal(googleInside(addr({ country: "GB", adminLevel2: "Norfolk" }), CAMBRIDGESHIRE), "no");
  assert.equal(googleInside(addr({ country: "GB" }), CAMBRIDGESHIRE), "approx");
  assert.equal(googleInside(addr({ country: "GB", adminLevel2: "CAMBRIDGESHIRE" }), CAMBRIDGESHIRE), "yes");
  const ariegeAccent: InsideArea = { ...ARIEGE, label: "Ariege", admin: {} };
  assert.equal(googleInside(addr({ country: "FR", adminLevel2: "Ariège" }), ariegeAccent), "yes");
});
