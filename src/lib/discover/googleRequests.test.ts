import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "./categories.ts";
import {
  GOOGLE_MASKS,
  GOOGLE_TYPES,
  MASK_DETAILS_ENTERPRISE,
  MASK_DETAILS_ESSENTIALS,
  MASK_SEARCH_PRO,
  attributionNames,
  candidatesOf,
  googleTradeFor,
  isKnownMask,
  languageFor,
  matchSearchBody,
  nearbySearchBody,
  parseDetailsEssentials,
  parseError,
  parseSearch,
  placeIdOk,
  regionFor,
  signalsOf,
  textSearchBody,
  withinCap,
} from "./googleRequests.ts";
import * as requests from "./googleRequests.ts";

const here = new URL(".", import.meta.url).pathname;
const fixture = (name: string): unknown => JSON.parse(readFileSync(`${here}fixtures/google/${name}`, "utf8"));

// ---- Appendix A: SKU tiers, verified 12 Sep 2026 ------------------------------------------------

const SEARCH_IDS_ONLY = ["id", "name", "attributions", "consumerAlert", "movedPlace", "movedPlaceId"];
/** Essentials-level fields bill Pro on the search endpoints; listed with Pro for the search mask test. */
const SEARCH_PRO = [
  ...SEARCH_IDS_ONLY,
  "addressComponents", "addressDescriptor", "adrFormatAddress", "formattedAddress", "location", "plusCode", "postalAddress", "shortFormattedAddress", "types", "viewport",
  "accessibilityOptions", "businessStatus", "containingPlaces", "displayName", "googleMapsLinks", "googleMapsTypeLabel", "googleMapsUri", "iconBackgroundColor", "iconMaskBaseUri", "openingDate", "photos", "primaryType", "primaryTypeDisplayName", "pureServiceAreaBusiness", "searchUri", "subDestinations", "timeZone", "utcOffsetMinutes",
];
const DETAILS_IDS_ONLY = ["attributions", "consumerAlert", "id", "movedPlace", "movedPlaceId", "name", "photos"];
const DETAILS_ESSENTIALS = [...DETAILS_IDS_ONLY, "addressComponents", "addressDescriptor", "adrFormatAddress", "formattedAddress", "location", "plusCode", "postalAddress", "shortFormattedAddress", "types", "viewport"];
const DETAILS_PRO = [...DETAILS_ESSENTIALS, "accessibilityOptions", "businessStatus", "containingPlaces", "displayName", "googleMapsLinks", "googleMapsTypeLabel", "googleMapsUri", "iconBackgroundColor", "iconMaskBaseUri", "openingDate", "primaryType", "primaryTypeDisplayName", "pureServiceAreaBusiness", "subDestinations", "timeZone", "utcOffsetMinutes"];
const DETAILS_ENTERPRISE = [...DETAILS_PRO, "currentOpeningHours", "currentSecondaryOpeningHours", "internationalPhoneNumber", "nationalPhoneNumber", "priceLevel", "priceRange", "rating", "regularOpeningHours", "regularSecondaryOpeningHours", "transitStation", "userRatingCount", "websiteUri"];
const TABLE_A = ["restaurant", "bar", "hotel", "bed_and_breakfast", "campground", "bakery", "butcher_shop", "hair_salon", "beauty_salon", "car_repair", "plumber", "electrician", "painter", "roofing_contractor", "real_estate_agency", "dentist", "gym"];

test("the three masks never cross their tier; there is no Pro Details mask", () => {
  const search = MASK_SEARCH_PRO.split(",");
  for (const f of search) {
    if (f === "nextPageToken") continue;
    assert.ok(f.startsWith("places."), f);
    assert.ok(SEARCH_PRO.includes(f.slice(7)), `search mask carries a field above Pro: ${f}`);
  }
  assert.ok(search.includes("nextPageToken"));
  assert.ok(!search.includes("places.photos"), "photos are Pro on search but unneeded — never requested");
  for (const f of MASK_DETAILS_ENTERPRISE.split(",")) assert.ok(DETAILS_ENTERPRISE.includes(f), `enterprise mask: ${f}`);
  for (const f of ["websiteUri", "regularOpeningHours", "rating", "userRatingCount", "nationalPhoneNumber", "photos"]) assert.ok(MASK_DETAILS_ENTERPRISE.split(",").includes(f), f);
  for (const f of MASK_DETAILS_ESSENTIALS.split(",")) assert.ok(DETAILS_ESSENTIALS.includes(f), `essentials mask carries a field above Essentials: ${f}`);
  assert.equal("MASK_DETAILS_PRO" in requests, false);
  assert.equal(GOOGLE_MASKS.length, 3);
  assert.equal(isKnownMask(MASK_SEARCH_PRO), true);
  assert.equal(isKnownMask(`${MASK_DETAILS_ESSENTIALS},websiteUri`), false);
  assert.equal(isKnownMask("places.id,places.websiteUri"), false);
  for (const m of GOOGLE_MASKS) assert.doesNotMatch(m, /\s/);
});

test("GOOGLE_TYPES covers every fixed trade; every includedType is a Table A type; joiner and optician are text only", () => {
  for (const c of CATEGORIES) {
    const t = GOOGLE_TYPES[c.key];
    assert.ok(t, c.key);
    assert.ok(t.query.fr && t.query.en, c.key);
    if (t.includedType !== null) assert.ok(TABLE_A.includes(t.includedType), `${c.key}: ${t.includedType}`);
  }
  assert.equal(GOOGLE_TYPES.joiner!.includedType, null);
  assert.equal(GOOGLE_TYPES.optician!.includedType, null);
  assert.equal(GOOGLE_TYPES.gite!.includedType, "bed_and_breakfast");
  assert.deepEqual(googleTradeFor({ key: "custom:tattoo", label: { fr: "Tatoueur", en: "Tattoo studio" }, custom: true }), { includedType: null, query: { fr: "Tatoueur", en: "Tattoo studio" } });
  assert.equal(googleTradeFor({ key: "restaurant", label: { fr: "Restaurant", en: "Restaurant" } }).includedType, "restaurant");
});

test("language and region follow the area's country", () => {
  for (const cc of ["FR", "BE", "CH", "LU", "MC", "AD"]) assert.equal(languageFor(cc), "fr", cc);
  assert.equal(languageFor("GB"), "en");
  assert.equal(languageFor("ES"), "en");
  assert.equal(regionFor("FR"), "fr");
  assert.equal(regionFor("XX"), "xx");
  assert.equal(regionFor(""), undefined);
});

test("withinCap: the reserve is kept back, and the last unit under the cap still fits", () => {
  assert.equal(withinCap(0, 900), true);
  assert.equal(withinCap(899, 900), true);
  assert.equal(withinCap(900, 900), false);
  assert.equal(withinCap(3999, 4500, 500), true);
  assert.equal(withinCap(4000, 4500, 500), false);
  assert.equal(withinCap(0, 0), false);
});

test("textSearchBody: rectangle low/high order, strict type only with a type, page size 20, token carried, bias clamp, exclusivity", () => {
  const b = textSearchBody({ textQuery: "restaurant", includedType: "restaurant", rect: [42.9, 1.5, 43.15, 1.75], languageCode: "fr", regionCode: "fr" });
  assert.deepEqual(b.locationRestriction, { rectangle: { low: { latitude: 42.9, longitude: 1.5 }, high: { latitude: 43.15, longitude: 1.75 } } });
  assert.equal(b.strictTypeFiltering, true);
  assert.equal(b.includedType, "restaurant");
  assert.equal(b.pageSize, 20);
  assert.equal(b.languageCode, "fr");
  assert.equal(b.regionCode, "fr");
  assert.equal("pageToken" in b, false);
  assert.equal("locationBias" in b, false);
  const paged = textSearchBody({ textQuery: "restaurant", includedType: "restaurant", rect: [42.9, 1.5, 43.15, 1.75], languageCode: "fr", pageToken: "tok-1" });
  assert.equal(paged.pageToken, "tok-1");
  const text = textSearchBody({ textQuery: "menuisier", includedType: null, bias: { lat: 42.9646, lng: 1.6053, radiusM: 80_000 }, languageCode: "fr" });
  assert.equal(text.strictTypeFiltering, false);
  assert.equal("includedType" in text, false);
  assert.deepEqual(text.locationBias, { circle: { center: { latitude: 42.9646, longitude: 1.6053 }, radius: 50_000 } });
  assert.equal("locationRestriction" in text, false);
  assert.throws(() => textSearchBody({ textQuery: "x", rect: [0, 0, 1, 1], bias: { lat: 0, lng: 0, radiusM: 10 }, languageCode: "en" }));
});

test("nearbySearchBody clamps the radius to 50 km and takes types only", () => {
  const b = nearbySearchBody({ includedTypes: ["restaurant"], center: { lat: 42.9646, lng: 1.6053 }, radiusM: 75_000, languageCode: "fr", regionCode: "fr" });
  assert.equal(b.locationRestriction.circle.radius, 50_000);
  assert.deepEqual(b.includedTypes, ["restaurant"]);
  assert.equal(b.maxResultCount, 20);
  assert.equal("textQuery" in b, false);
  assert.equal(nearbySearchBody({ includedTypes: ["bar"], center: { lat: 0, lng: 0 }, radiusM: 4_000 }).locationRestriction.circle.radius, 4_000);
});

test("matchSearchBody: '<name> <city>', a 2 km bias with coordinates, region only without", () => {
  const withPoint = matchSearchBody({ name: "Le Phoebus", city: "Foix", lat: 42.9646, lng: 1.6053, countryCode: "FR" });
  assert.equal(withPoint.textQuery, "Le Phoebus Foix");
  assert.equal(withPoint.pageSize, 5);
  assert.equal(withPoint.languageCode, "fr");
  assert.equal(withPoint.regionCode, "fr");
  assert.deepEqual(withPoint.locationBias, { circle: { center: { latitude: 42.9646, longitude: 1.6053 }, radius: 2_000 } });
  const noPoint = matchSearchBody({ name: "Cam Bakes", city: null, countryCode: "GB" });
  assert.equal(noPoint.textQuery, "Cam Bakes");
  assert.equal(noPoint.regionCode, "gb");
  assert.equal(noPoint.languageCode, "en");
  assert.equal("locationBias" in noPoint, false);
});

test("parseSearch keeps our fields only, drops unknown ones, carries attributions and the token", () => {
  const p1 = parseSearch(fixture("text-search.tile1.page1.json"));
  assert.equal(p1.places.length, 20);
  assert.ok(p1.nextPageToken);
  const first = p1.places[0]!;
  assert.deepEqual(Object.keys(first).sort(), ["addressLine", "adminLevel1", "adminLevel2", "attributions", "country", "lat", "lng", "locality", "name", "operational", "placeId", "postalTown", "postcode", "serviceArea"].sort());
  assert.equal("ignoredExtraField" in first, false);
  assert.equal(first.country, "FR");
  assert.equal(first.adminLevel2, "Ariège");
  assert.equal(first.adminLevel1, "Occitanie");
  assert.equal(first.postcode, "09000");
  assert.equal(first.locality, "Foix");
  assert.equal(first.operational, true);
  assert.equal(first.serviceArea, false);
  assert.deepEqual(p1.places[3]!.attributions, ["Example Data Co"]);
  assert.deepEqual(first.attributions, []);
  const andorra = p1.places[17]!;
  assert.equal(andorra.country, "AD");
  const po = p1.places[18]!;
  assert.equal(po.postcode, "66210");
  assert.equal(po.adminLevel2, "Pyrénées-Orientales");
  const bare = p1.places[19]!;
  assert.equal(bare.postcode, null);
  assert.equal(bare.country, null);
  assert.equal(bare.locality, null);
  const p2 = parseSearch(fixture("text-search.tile1.page2.json"));
  assert.equal(p2.places.length, 12);
  assert.equal(p2.nextPageToken, null);
  assert.deepEqual(parseSearch({}), { places: [], nextPageToken: null });
  assert.deepEqual(parseSearch(null), { places: [], nextPageToken: null });
  assert.deepEqual(parseSearch({ places: [{ id: "short" }, { displayName: { text: "no id" } }] }).places, []);
});

test("signalsOf: only booleans, numbers, fetchedAt and attribution names; the three fixtures give 10, 5 and 4 points' worth of inputs", () => {
  const now = new Date("2026-09-12T10:00:00Z");
  const maintained = signalsOf(fixture("details.enterprise.maintained.json"), now);
  assert.deepEqual(maintained, { operational: true, websiteOnListing: true, hours: true, reviews: 37, photos: 3, fetchedAt: "2026-09-12T10:00:00.000Z", attributions: [] });
  const unmaintained = signalsOf(fixture("details.enterprise.unmaintained.json"), now);
  assert.deepEqual(unmaintained, { operational: true, websiteOnListing: false, hours: false, reviews: 2, photos: 0, fetchedAt: "2026-09-12T10:00:00.000Z", attributions: ["Example Data Co"] });
  const closed = signalsOf(fixture("details.enterprise.closed.json"), now);
  assert.equal(closed.operational, false);
  assert.equal(closed.websiteOnListing, true);
  assert.equal(closed.hours, true);
  assert.equal(closed.reviews, 12);
  assert.equal(closed.photos, 1);
  for (const s of [maintained, unmaintained, closed]) {
    assert.deepEqual(Object.keys(s).sort(), ["attributions", "fetchedAt", "hours", "operational", "photos", "reviews", "websiteOnListing"]);
    for (const [k, v] of Object.entries(s)) {
      if (k === "fetchedAt") assert.equal(typeof v, "string");
      else if (k === "attributions") {
        assert.ok(Array.isArray(v) && v.length <= 5 && v.every((x) => typeof x === "string" && x.length <= 80));
      } else assert.ok(typeof v === "boolean" || typeof v === "number" || v === null, k);
    }
  }
  // Unspecified status → null; junk → zeros.
  assert.equal(signalsOf({ businessStatus: "BUSINESS_STATUS_UNSPECIFIED" }, now).operational, null);
  assert.deepEqual(signalsOf(null, now), { operational: null, websiteOnListing: false, hours: false, reviews: 0, photos: 0, fetchedAt: now.toISOString(), attributions: [] });
  assert.deepEqual(attributionNames([{ provider: "A" }, { provider: "A" }, { provider: "B", providerUri: "x" }, { provider: "C" }, { provider: "D" }, { provider: "E" }, { provider: "F" }]), ["A", "B", "C", "D", "E"]);
  assert.equal(attributionNames([{ provider: "x".repeat(200) }])[0]!.length, 80);
});

test("parseDetailsEssentials: kind hints and geocoder queries for Ariège and Cambridge", () => {
  const ariege = parseDetailsEssentials(fixture("details.essentials.ariege.json"))!;
  assert.equal(ariege.kindHint, "department");
  assert.equal(ariege.query, "Ariège, France");
  assert.equal(ariege.countryCode, "FR");
  assert.equal(ariege.adminLevel1, "Occitanie");
  assert.equal(ariege.adminLevel2, "Ariège");
  assert.equal(ariege.lat, 42.9455368);
  const cam = parseDetailsEssentials(fixture("details.essentials.cambridge-uk.json"))!;
  assert.equal(cam.kindHint, "town");
  assert.equal(cam.query, "Cambridge, United Kingdom");
  assert.equal(cam.countryCode, "GB");
  assert.equal(cam.adminLevel2, "Cambridgeshire");
  assert.equal(parseDetailsEssentials({ id: "ChIJabcdefghijklmnop" }), null);
  const country = parseDetailsEssentials({ id: "ChIJabcdefghijklmnop", types: ["country", "political"], location: { latitude: 42.5, longitude: 1.5 }, addressComponents: [{ longText: "Andorra", shortText: "AD", types: ["country", "political"] }] })!;
  assert.equal(country.kindHint, "country");
  assert.equal(country.query, "Andorra");
  const odd = parseDetailsEssentials({ id: "ChIJabcdefghijklmnop", types: ["natural_feature"], formattedAddress: "Somewhere", location: { latitude: 1, longitude: 2 } })!;
  assert.equal(odd.kindHint, "place");
  assert.equal(odd.query, "Somewhere");
});

test("candidatesOf: ≤ 5, first address line, distance when both sides have coordinates, attributions kept", () => {
  const { places } = parseSearch(fixture("text-search.match.json"));
  const list = candidatesOf(places, { lat: 42.9646, lng: 1.6053 });
  assert.equal(list.length, 5);
  assert.equal(list[0]!.name, "Le Phoebus Restaurant");
  assert.equal(list[0]!.addressLine, "3 Cours Irénée Cros");
  assert.ok(list[0]!.distanceM !== null && list[0]!.distanceM < 60 && list[0]!.distanceM > 20, String(list[0]!.distanceM));
  assert.deepEqual(list[0]!.attributions, ["Example Data Co"]);
  assert.deepEqual(Object.keys(list[0]!).sort(), ["addressLine", "attributions", "distanceM", "name", "placeId"]);
  assert.equal(candidatesOf(places, { lat: null, lng: null })[0]!.distanceM, null);
  assert.equal(candidatesOf([...places, ...places], { lat: 1, lng: 1 }).length, 5);
});

test("placeIdOk: 27-char ok, 72 ok, 73 refused, 9 refused, junk refused", () => {
  assert.equal(placeIdOk("ChIJzNi9bwKs9LtNoyWoHn_J10Z"), true);
  assert.equal(placeIdOk(`ChIJ${"x".repeat(68)}`), true);
  assert.equal(placeIdOk(`ChIJ${"x".repeat(69)}`), false);
  assert.equal(placeIdOk("ChIJabcde"), false);
  assert.equal(placeIdOk("ChIJ abcdefghijk"), false);
  assert.equal(placeIdOk("google:ChIJabcdefghijklmnop"), false);
  assert.equal(placeIdOk(42), false);
  assert.equal(placeIdOk(null), false);
  const { places } = parseSearch(fixture("text-search.match.json"));
  assert.equal(places[1]!.placeId.length, 72);
});

test("parseError maps status codes and Google's status words", () => {
  assert.equal(parseError(403, fixture("error.403.json")), "refused");
  assert.equal(parseError(429, fixture("error.429.json")), "busy");
  assert.equal(parseError(400), "bad_request");
  assert.equal(parseError(404), "bad_request");
  assert.equal(parseError(500), "unavailable");
  assert.equal(parseError(503), "unavailable");
  assert.equal(parseError(0), "network");
  assert.equal(parseError(200, { error: { status: "PERMISSION_DENIED" } }), "refused");
});
