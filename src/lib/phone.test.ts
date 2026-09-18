import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRIES,
  PHONE_TEXT,
  countryFor,
  countryFromLanguages,
  countryFromTimeZone,
  guessCountry,
  normalisePhone,
  validatePhone,
} from "./phone.ts";
import type { Country } from "./phone.ts";

const FR = countryFor("FR")!;
const CA = countryFor("CA")!;
const GB = countryFor("GB")!;
const US = countryFor("US")!;

test("the Quebec incident: a 10-digit number under +33 is rejected", () => {
  // Stored on 17 Sep 2026 as "+33 4187172114" — impossible in France.
  const res = validatePhone("+33 4187172114", FR);
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "long");
});

test("the same digits under Canada are a valid number", () => {
  const res = validatePhone("4187172114", CA);
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.national, "4187172114");
  assert.equal(res.ok === true && res.e164, "+14187172114");
});

test("a French number loses its trunk 0", () => {
  const res = validatePhone("0630912844", FR);
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.national, "630912844");
  assert.equal(res.ok === true && res.e164, "+33630912844");
});

test("spacing, +33 and 0033 all reach the same E.164", () => {
  for (const raw of [
    "0630912844",
    "06 30 91 28 44",
    "06.30.91.28.44",
    "+33 6 30 91 28 44",
    "+33630912844",
    "0033630912844",
    "0033 6 30 91 28 44",
    "33630912844",
  ]) {
    const res = validatePhone(raw, FR);
    assert.equal(res.ok, true, `expected ${raw} to be valid`);
    assert.equal(res.ok === true && res.e164, "+33630912844", `wrong e164 for ${raw}`);
  }
});

test("North American punctuation is ignored", () => {
  for (const raw of ["418-717-2114", "(418) 717-2114", "+1 418 717 2114", "1 418 717 2114"]) {
    const res = validatePhone(raw, CA);
    assert.equal(res.ok, true, `expected ${raw} to be valid`);
    assert.equal(res.ok === true && res.e164, "+14187172114", `wrong e164 for ${raw}`);
  }
});

test("too short, too long, empty", () => {
  assert.equal(validatePhone("12345", FR).ok, false);
  const short = validatePhone("12345", FR);
  assert.equal(short.ok === false && short.reason, "short");

  const long = validatePhone("06309128440000", FR);
  assert.equal(long.ok === false && long.reason, "long");

  for (const raw of ["", "   ", "+", "--"]) {
    const res = validatePhone(raw, FR);
    assert.equal(res.ok === false && res.reason, "empty", `expected ${raw} to be empty`);
  }
});

test("UK keeps 9 or 10 digits after the trunk 0", () => {
  assert.equal(validatePhone("07911 123456", GB).ok, true);
  const gb = validatePhone("07911 123456", GB);
  assert.equal(gb.ok === true && gb.e164, "+447911123456");
  assert.equal(validatePhone("+44 7911 123456", GB).ok, true);
  assert.equal(validatePhone("1234", GB).ok, false);
});

test("countries without a trunk prefix keep every digit", () => {
  // Italy: landlines keep their leading 0.
  const it = countryFor("IT")!;
  const res = validatePhone("06 6982", it);
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.e164, "+39066982");
  // A US number is never shortened by a leading 1 that belongs to the number.
  assert.equal(normalisePhone("2125551234", US), "2125551234");
});

test("countryFromTimeZone maps the zones the ad campaign reaches", () => {
  for (const tz of [
    "America/Toronto",
    "America/Montreal",
    "America/Winnipeg",
    "America/Edmonton",
    "America/Vancouver",
    "America/Halifax",
    "America/St_Johns",
  ]) {
    assert.equal(countryFromTimeZone(tz), "CA", tz);
  }
  for (const tz of [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ]) {
    assert.equal(countryFromTimeZone(tz), "US", tz);
  }
  assert.equal(countryFromTimeZone("Europe/Paris"), "FR");
  assert.equal(countryFromTimeZone("Europe/London"), "GB");
  assert.equal(countryFromTimeZone("Australia/Sydney"), "AU");
  assert.equal(countryFromTimeZone("Pacific/Auckland"), "NZ");
  assert.equal(countryFromTimeZone("europe/brussels"), "BE");
  assert.equal(countryFromTimeZone("Asia/Tokyo"), null);
  assert.equal(countryFromTimeZone(""), null);
  assert.equal(countryFromTimeZone(null), null);
  assert.equal(countryFromTimeZone(undefined), null);
});

const ZONE_SAMPLES: Record<string, string> = {
  FR: "Europe/Paris", GB: "Europe/London", US: "America/New_York", CA: "America/Toronto",
  IE: "Europe/Dublin", BE: "Europe/Brussels", CH: "Europe/Zurich", LU: "Europe/Luxembourg",
  DE: "Europe/Berlin", ES: "Europe/Madrid", IT: "Europe/Rome", NL: "Europe/Amsterdam",
  PT: "Europe/Lisbon", AT: "Europe/Vienna", DK: "Europe/Copenhagen", SE: "Europe/Stockholm",
  NO: "Europe/Oslo", FI: "Europe/Helsinki", PL: "Europe/Warsaw", CZ: "Europe/Prague",
  RO: "Europe/Bucharest", GR: "Europe/Athens", HU: "Europe/Budapest", AU: "Australia/Sydney",
  NZ: "Pacific/Auckland", AE: "Asia/Dubai", SA: "Asia/Riyadh", MA: "Africa/Casablanca",
  TN: "Africa/Tunis", DZ: "Africa/Algiers", ZA: "Africa/Johannesburg", SG: "Asia/Singapore",
};

test("every country in the list has at least one time zone pointing at it", () => {
  for (const country of COUNTRIES) {
    const hit = ZONE_SAMPLES[country.c];
    assert.ok(hit, `no sample zone for ${country.c}`);
    assert.equal(countryFromTimeZone(hit), country.c, `${hit} should map to ${country.c}`);
  }
});

test("countryFromLanguages reads the region subtag", () => {
  assert.equal(countryFromLanguages(["fr-CA", "fr"]), "CA");
  assert.equal(countryFromLanguages(["fr"]), null);
  assert.equal(countryFromLanguages(["en-GB", "en"]), "GB");
  assert.equal(countryFromLanguages(["fr", "fr-CA", "en-US"]), "CA");
  assert.equal(countryFromLanguages(["zh-Hans-CN", "en-IE"]), "IE");
  assert.equal(countryFromLanguages([]), null);
  assert.equal(countryFromLanguages(null), null);
  assert.equal(countryFromLanguages(undefined), null);
});

test("guessCountry: time zone beats language beats the page default", () => {
  assert.equal(
    guessCountry({
      timeZone: "America/Montreal",
      languages: ["fr-FR", "fr"],
      fallbackDial: "+33",
    }).c,
    "CA",
  );
  assert.equal(
    guessCountry({ timeZone: "Asia/Tokyo", languages: ["fr-CA", "fr"], fallbackDial: "+33" }).c,
    "CA",
  );
  assert.equal(
    guessCountry({ timeZone: "Asia/Tokyo", languages: ["ja"], fallbackDial: "+44" }).c,
    "GB",
  );
  assert.equal(guessCountry({ timeZone: "Asia/Tokyo", languages: ["ja"], fallbackDial: "+999" }).c, "FR");
  assert.equal(guessCountry({}).c, "FR");
  assert.equal(guessCountry({ timeZone: null, languages: null, fallbackDial: null }).c, "FR");
  // A French page opened from Paris still starts on France.
  assert.equal(
    guessCountry({ timeZone: "Europe/Paris", languages: ["fr-FR", "fr"], fallbackDial: "+33" }).c,
    "FR",
  );
});

test("the country list stays well formed", () => {
  assert.equal(COUNTRIES.length, 32);
  const seen = new Set<string>();
  for (const country of COUNTRIES) {
    assert.match(country.dial, /^\+\d{1,4}$/, `bad dial for ${country.c}`);
    assert.ok(country.min <= country.max, `min > max for ${country.c}`);
    assert.ok(country.min >= 4 && country.max <= 15, `odd length rules for ${country.c}`);
    assert.match(country.c, /^[A-Z]{2}$/);
    assert.ok(country.name.length > 0);
    assert.ok(country.flag.length > 0);
    assert.equal(typeof country.trunk, "boolean");
    assert.ok(!seen.has(country.c), `duplicate ${country.c}`);
    seen.add(country.c);
  }
  // Order is part of the UI: France first, then the United Kingdom.
  assert.equal(COUNTRIES[0]!.c, "FR");
  assert.equal(COUNTRIES[1]!.c, "GB");
});

test("PHONE_TEXT carries the same keys in French and English", () => {
  assert.deepEqual(Object.keys(PHONE_TEXT.fr).sort(), Object.keys(PHONE_TEXT.en).sort());
  for (const lang of ["fr", "en"] as const) {
    const copy = PHONE_TEXT[lang];
    for (const key of ["empty", "short", "long"] as const) {
      assert.equal(typeof copy[key], "string");
      assert.ok(copy[key].length > 0, `${lang}.${key} is empty`);
    }
    assert.equal(typeof copy.hint, "function");
  }
});

test("the hint names the country and the expected length", () => {
  assert.equal(PHONE_TEXT.fr.hint(FR), "Un numéro français a 9 chiffres après +33.");
  assert.equal(PHONE_TEXT.en.hint(FR), "A French number has 9 digits after +33.");
  assert.equal(PHONE_TEXT.fr.hint(GB), "Un numéro britannique a entre 9 et 10 chiffres après +44.");
  assert.equal(PHONE_TEXT.en.hint(CA), "A Canadian number has 10 digits after +1.");
  for (const country of COUNTRIES) {
    for (const lang of ["fr", "en"] as const) {
      const hint: string = PHONE_TEXT[lang].hint(country as Country);
      assert.ok(hint.endsWith(`${country.dial}.`), `${lang} hint for ${country.c}: ${hint}`);
      assert.ok(!hint.includes("undefined"), `${lang} hint for ${country.c}: ${hint}`);
      assert.ok(!hint.includes("—"), `no em dash allowed: ${hint}`);
      assert.ok(hint.includes(String(country.min)), `${lang} hint for ${country.c}: ${hint}`);
    }
  }
});

// The English hint opens with an article, and it has to agree with the
// adjective that follows it: "An American number", never "A American number".
const EN_AN = new Set(["US", "IE", "IT", "AT", "AU", "AE", "DZ"]);

test("the English hint uses the right article for every country", () => {
  assert.equal(PHONE_TEXT.en.hint(US), "An American number has 10 digits after +1.");
  assert.equal(
    PHONE_TEXT.en.hint(countryFor("IE")!),
    "An Irish number has between 7 and 9 digits after +353.",
  );
  assert.equal(
    PHONE_TEXT.en.hint(countryFor("IT")!),
    "An Italian number has between 6 and 11 digits after +39.",
  );
  assert.equal(
    PHONE_TEXT.en.hint(countryFor("AT")!),
    "An Austrian number has between 4 and 13 digits after +43.",
  );
  assert.equal(PHONE_TEXT.en.hint(countryFor("AU")!), "An Australian number has 9 digits after +61.");
  assert.equal(PHONE_TEXT.en.hint(countryFor("AE")!), "An Emirati number has 9 digits after +971.");
  assert.equal(PHONE_TEXT.en.hint(countryFor("DZ")!), "An Algerian number has 9 digits after +213.");

  for (const country of COUNTRIES) {
    const hint = PHONE_TEXT.en.hint(country);
    const expected = EN_AN.has(country.c) ? "An " : "A ";
    assert.ok(hint.startsWith(expected), `${country.c} should start with "${expected}": ${hint}`);
  }
});

test("the Gulf countries accept the local form with its trunk 0", () => {
  // "050 123 4567" in Dubai is +971 50 123 4567: rejecting it loses the lead.
  const ae = countryFor("AE")!;
  const ae0 = validatePhone("050 123 4567", ae);
  assert.equal(ae0.ok, true);
  assert.equal(ae0.ok === true && ae0.e164, "+971501234567");
  const aeIntl = validatePhone("+971 50 123 4567", ae);
  assert.equal(aeIntl.ok === true && aeIntl.e164, "+971501234567");

  const sa = countryFor("SA")!;
  const sa0 = validatePhone("0512345678", sa);
  assert.equal(sa0.ok, true);
  assert.equal(sa0.ok === true && sa0.e164, "+966512345678");
});

test("a bare dial code that is part of the number is left alone", () => {
  // German 04921 12345 typed without its trunk 0: the "49" is the area code,
  // not the country code, and the whole thing already fits Germany.
  const de = countryFor("DE")!;
  assert.equal(normalisePhone("492112345", de), "492112345");
  const res = validatePhone("492112345", de);
  assert.equal(res.ok === true && res.e164, "+49492112345");
  // A number that only fits once the dial code goes is still unwrapped.
  assert.equal(normalisePhone("33630912844", FR), "630912844");
});
