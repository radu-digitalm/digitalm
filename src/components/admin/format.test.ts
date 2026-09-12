import { test } from "node:test";
import assert from "node:assert/strict";
import { countryName, domainOf, formatDuration, formatEta, formatInt, formatKm, googleSearchUrl, localDate, localDateTime, openingHoursWords, plural, relativeOrLocal, shortDateTime, townLine, townParen } from "./format.ts";
import { PLACE_ID_RE, googleMapsPlaceUrl, placeIdOk } from "./googleMaps.ts";

test("googleMapsPlaceUrl is built from a validated place id only (docs/finder-google-spec.md §5.1)", () => {
  const id27 = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  const id72 = "A".repeat(72);
  assert.equal(id27.length, 27);
  assert.equal(googleMapsPlaceUrl(id27), `https://www.google.com/maps/place/?q=place_id:${id27}`);
  assert.equal(googleMapsPlaceUrl(id72), `https://www.google.com/maps/place/?q=place_id:${id72}`);
  assert.equal(googleMapsPlaceUrl("A".repeat(73)), null);
  assert.equal(googleMapsPlaceUrl("short"), null);
  assert.equal(googleMapsPlaceUrl("ChIJ N1t_tDeuEmsRUsoyG83frY4"), null);
  assert.equal(googleMapsPlaceUrl("<script>alert(1)</script>"), null);
  assert.equal(googleMapsPlaceUrl(null), null);
  assert.equal(googleMapsPlaceUrl(undefined), null);
  assert.equal(googleMapsPlaceUrl(42), null);
  assert.ok(placeIdOk(id27) && placeIdOk(id72) && !placeIdOk("A".repeat(9)) && !placeIdOk("A".repeat(73)));
  assert.equal(String(PLACE_ID_RE), "/^[A-Za-z0-9_-]{10,72}$/");
});

test("opening hours read as words; unusual syntax is left alone", () => {
  assert.equal(openingHoursWords("Tu-Su 12:00-14:00,19:00-22:00; Mo off"), "Tue–Sun 12:00–14:00, 19:00–22:00 · Mon closed");
  assert.equal(openingHoursWords("24/7"), "24 hours a day");
  assert.equal(openingHoursWords("Mo-Fr 09:00-18:00; PH off"), "Mon–Fri 09:00–18:00 · public holidays closed");
  assert.equal(openingHoursWords('"sur réservation"'), '"sur réservation"');
  assert.equal(openingHoursWords(""), "");
  assert.equal(openingHoursWords(null), "");
});

test("googleSearchUrl joins the terms and encodes them", () => {
  assert.equal(googleSearchUrl("Alzimut", null, "Alzen"), "https://www.google.com/search?q=Alzimut%20Alzen");
});

test("localDateTime renders Europe/Paris from SQL UTC and ISO strings, including DST", () => {
  // 12 Sep 2026 07:04 UTC = 09:04 CEST (UTC+2)
  assert.equal(localDateTime("2026-09-12 07:04:11"), "12 Sep 2026, 09:04");
  assert.equal(localDateTime("2026-09-12T07:04:11Z"), "12 Sep 2026, 09:04");
  assert.equal(localDateTime("2026-09-12T07:04:11.000Z"), "12 Sep 2026, 09:04");
  // 12 Jan 2026 23:30 UTC = 00:30 CET next day (UTC+1)
  assert.equal(localDateTime("2026-01-12 23:30:00"), "13 Jan 2026, 00:30");
  assert.equal(localDateTime(null), "");
  assert.equal(localDateTime("garbage"), "");
  assert.equal(localDate("2026-09-12 07:04:11"), "12 Sep 2026");
  assert.equal(shortDateTime("2026-09-12 07:47:00"), "12 Sep, 09:47");
});

test("relativeOrLocal: under 24 h relative, else the short local stamp", () => {
  const now = new Date("2026-09-12T10:00:00Z");
  assert.equal(relativeOrLocal("2026-09-12T09:59:40Z", now), "just now");
  assert.equal(relativeOrLocal("2026-09-12T09:55:00Z", now), "5 min ago");
  assert.equal(relativeOrLocal("2026-09-12 08:00:00", now), "2 h ago");
  assert.equal(relativeOrLocal("2026-09-11T09:00:00Z", now), "11 Sep, 11:00");
  assert.equal(relativeOrLocal("2026-09-13T09:00:00Z", now), "13 Sep, 11:00"); // future → local
  assert.equal(relativeOrLocal(null, now), "");
});

test("numbers: thousands, kilometres, durations", () => {
  assert.equal(formatInt(12000), "12,000");
  assert.equal(formatInt(289), "289");
  assert.equal(formatInt(null), "");
  assert.equal(formatKm(16.44), "16.4");
  assert.equal(formatKm(0.04), "0.0");
  assert.equal(formatKm(120.3), "120");
  assert.equal(formatKm(null), "");
  assert.equal(formatDuration(48_000), "48 s");
  assert.equal(formatDuration(130_000), "2 min 10 s");
  assert.equal(formatDuration(3_780_000), "1 h 3 min");
  assert.equal(formatEta(40), "40 s");
  assert.equal(formatEta(150), "3 min");
  assert.equal(formatEta(null), "");
  assert.equal(plural(1, "business", "businesses"), "1 business");
  assert.equal(plural(1240, "business", "businesses"), "1,240 businesses");
});

test("country names, towns, domains", () => {
  assert.equal(countryName("FR"), "France");
  assert.equal(countryName("GB"), "United Kingdom");
  assert.equal(countryName("AD"), "Andorra");
  assert.equal(countryName(""), "");
  assert.equal(townLine("09000", "Foix"), "09000 Foix");
  assert.equal(townLine(null, "Foix"), "Foix");
  assert.equal(townParen("09000", "Foix"), "Foix (09000)");
  assert.equal(townParen(null, null), "");
  assert.equal(domainOf("https://www.example.fr/contact"), "example.fr");
  assert.equal(domainOf("example.fr/x"), "example.fr");
  assert.equal(domainOf(null), "");
});
