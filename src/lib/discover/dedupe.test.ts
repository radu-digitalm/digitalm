import { test } from "node:test";
import assert from "node:assert/strict";
import { domainKeyOf, mergeBusinesses, nameKeyOf, sameByNameAndPlace } from "./dedupe.ts";
import type { Business } from "../crm/types.ts";

function osm(over: Partial<Business> = {}): Business {
  return {
    source: "osm",
    sourceId: "node/1",
    sourceUrl: "https://www.openstreetmap.org/node/1",
    name: "Le Fournil de Foix",
    countryCode: "FR",
    lat: 42.9655,
    lng: 1.6053,
    geoSource: "source",
    postcode: "09000",
    city: "Foix",
    website: "https://www.fournil-foix.fr/",
    phone: "+33 5 61 00 00 00",
    ...over,
  };
}

function reg(over: Partial<Business> = {}): Business {
  return {
    source: "fr_register",
    sourceId: "12345678900012",
    sourceUrl: "https://annuaire-entreprises.data.gouv.fr/etablissement/12345678900012",
    name: "LE FOURNIL DE FOIX",
    legalName: "SARL LE FOURNIL DE FOIX",
    enseigne: "LE FOURNIL DE FOIX",
    countryCode: "FR",
    lat: 42.9658,
    lng: 1.6049,
    geoSource: "source",
    addressLine: "12 RUE DE LA PAIX",
    postcode: "09000",
    city: "FOIX",
    registerId: "12345678900012",
    legalForm: "5499",
    soleTrader: false,
    diffusion: "full",
    active: true,
    ...over,
  };
}

test("rule 1: same source + sourceId collapses to one row", () => {
  const out = mergeBusinesses([osm(), osm({ phone: "+33 5 61 11 11 11" })]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.sources, ["osm"]);
});

test("rule 2: same registrable domain merges across sources", () => {
  const out = mergeBusinesses([
    osm({ name: "Fournil", lat: undefined, lng: undefined, geoSource: "none", postcode: undefined }),
    reg({ name: "Boulangerie Martin", website: "http://fournil-foix.fr/contact", lat: undefined, lng: undefined, geoSource: "centre" }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.sources, ["fr_register", "osm"]);
});

test("rule 3: equal normalised names within 150 m merge; 2 km apart do not", () => {
  const near = mergeBusinesses([osm({ website: undefined }), reg()]);
  assert.equal(near.length, 1);
  const far = mergeBusinesses([osm({ website: undefined, lat: 42.98, lng: 1.62 }), reg()]);
  assert.equal(far.length, 2);
});

test("rule 3: same postcode counts when a side has no coordinates", () => {
  const out = mergeBusinesses([osm({ website: undefined }), reg({ lat: undefined, lng: undefined, geoSource: "centre" })]);
  assert.equal(out.length, 1);
  const other = mergeBusinesses([osm({ website: undefined }), reg({ lat: undefined, lng: undefined, geoSource: "centre", postcode: "09100" })]);
  assert.equal(other.length, 2);
});

test("merged row keeps register identity, OSM contact and coordinates, lists sources", () => {
  const [m] = mergeBusinesses([osm(), reg()]);
  assert.ok(m);
  assert.equal(m.source, "fr_register");
  assert.equal(m.sourceId, "12345678900012");
  assert.equal(m.key, "fr_register:12345678900012");
  assert.equal(m.registerId, "12345678900012");
  assert.equal(m.legalName, "SARL LE FOURNIL DE FOIX");
  assert.equal(m.soleTrader, false);
  assert.equal(m.diffusion, "full");
  assert.equal(m.website, "https://www.fournil-foix.fr/");
  assert.equal(m.phone, "+33 5 61 00 00 00");
  assert.equal(m.lat, 42.9655);
  assert.equal(m.lng, 1.6053);
  assert.equal(m.name, "Le Fournil de Foix");
  assert.deepEqual(m.sources, ["fr_register", "osm"]);
  assert.equal(m.provenance.website, "osm");
  assert.equal(m.provenance.phone, "osm");
  assert.equal(m.provenance.geo, "osm");
  assert.equal(m.provenance.name, "osm");
  assert.equal(m.addressLine, "12 RUE DE LA PAIX");
});

test("Companies House row without coordinates merges with OSM on name + postcode and drops the registered-office marker", () => {
  const ch: Business = {
    source: "companies_house",
    sourceId: "01234567",
    sourceUrl: "https://find-and-update.company-information.service.gov.uk/company/01234567",
    name: "HAVANT HAIR LTD",
    legalName: "HAVANT HAIR LTD",
    countryCode: "GB",
    geoSource: "none",
    addressLine: "1 West Street",
    postcode: "PO9 1AA",
    city: "Havant",
    registerId: "01234567",
    legalForm: "ltd",
    soleTrader: false,
    active: true,
    registeredOfficeOnly: true,
  };
  const shop = osm({ name: "Havant Hair", countryCode: "GB", postcode: "PO9 1AA", city: "Havant", lat: 50.85, lng: -0.98, website: undefined });
  const [m] = mergeBusinesses([shop, ch]);
  assert.ok(m);
  assert.equal(m.source, "companies_house");
  assert.equal(m.registeredOfficeOnly, undefined);
  assert.equal(m.lat, 50.85);
  assert.deepEqual(m.sources, ["companies_house", "osm"]);
  const [alone] = mergeBusinesses([ch]);
  assert.equal(alone!.registeredOfficeOnly, true);
});

test("different businesses stay apart; rows without a name are dropped", () => {
  const out = mergeBusinesses([
    osm({ sourceId: "node/1", name: "Bar du Centre", website: undefined }),
    osm({ sourceId: "node/2", name: "Café des Sports", website: undefined }),
    osm({ sourceId: "node/3", name: "", website: undefined }),
  ]);
  assert.equal(out.length, 2);
});

test("transitive merge: OSM ↔ register by name, register ↔ second OSM by domain", () => {
  const out = mergeBusinesses([
    osm({ sourceId: "node/1", website: undefined }),
    reg({ website: "https://fournil-foix.fr" }),
    osm({ sourceId: "node/2", name: "Fournil (dépôt)", lat: 42.99, lng: 1.7, website: "https://www.fournil-foix.fr/depot" }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.sources, ["fr_register", "osm"]);
});

test("helpers: nameKeyOf strips legal forms; domainKeyOf ignores www and paths", () => {
  assert.equal(nameKeyOf({ name: "SARL Le Fournil de Foix" }), "le fournil de foix");
  assert.equal(nameKeyOf({ name: "", enseigne: "LE FOURNIL" }), "le fournil");
  assert.equal(domainKeyOf({ website: "https://www.fournil-foix.fr/contact?x=1" }), "fournil-foix.fr");
  assert.equal(domainKeyOf({ website: undefined }), null);
  assert.equal(domainKeyOf({ website: "javascript:alert(1)" }), null);
});

test("sameByNameAndPlace: both sides without coordinates need the same postcode", () => {
  const a = { name: "Salon Zoé", geoSource: "none" as const, postcode: "09000" };
  const b = { name: "SALON ZOE", geoSource: "centre" as const, postcode: "09 000", lat: 1, lng: 1 };
  assert.equal(sameByNameAndPlace(a, b), true);
  assert.equal(sameByNameAndPlace(a, { ...b, postcode: undefined }), false);
});
