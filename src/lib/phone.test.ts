import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRIES,
  PHONE_TEXT,
  checkPostedPhone,
  countryFor,
  countryFromE164,
  countryFromLanguages,
  countryFromTimeZone,
  guessCountry,
  normalisePhone,
  repairPostedPhone,
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

test("a French number typed while the picker sits on Canada is refused", () => {
  // A French expat in Quebec gets CA from the time zone. Ten digits is the
  // right count for Canada, so only the shape catches it.
  const res = validatePhone("0630912844", CA);
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "shape");
  // Neither the area code nor the exchange may start with 0 or 1.
  assert.equal(validatePhone("1187172114", CA).ok, false);
  assert.equal(validatePhone("4180172114", CA).ok, false);
  // Real North American numbers are untouched.
  assert.equal(validatePhone("2125551234", US).ok, true);
  assert.equal(validatePhone("418 717 2114", CA).ok, true);
});

test("a number from a country the picker does not carry is taken as typed", () => {
  // Brazil, India, Japan… are not in the list. On main these leads arrived
  // with a wrong dial code; refusing them outright would lose them instead.
  const br = validatePhone("+55 11 98765 4321", FR);
  assert.equal(br.ok, true);
  assert.equal(br.ok === true && br.foreign, true);
  assert.equal(br.ok === true && br.e164, "+5511987654321");

  const jp = validatePhone("0081 3 1234 5678", FR);
  assert.equal(jp.ok === true && jp.e164, "+81312345678");

  // Another country that IS in the list, typed in full: same treatment.
  const ca = validatePhone("+1 418 717 2114", FR);
  assert.equal(ca.ok === true && ca.e164, "+14187172114");
  assert.equal(ca.ok === true && ca.foreign, true);
});

test("a number under the picked country is never marked foreign", () => {
  for (const raw of ["0630912844", "+33 6 30 91 28 44", "0033630912844"]) {
    const res = validatePhone(raw, FR);
    assert.equal(res.ok === true && res.foreign, false, raw);
    assert.equal(res.ok === true && res.e164, "+33630912844", raw);
  }
});

test("a stray + in front of a domestic number still follows the country rules", () => {
  // E.164 never has a 0 after the +, so "+0630912844" is a French number with
  // a typo, not an international one.
  const res = validatePhone("+0630912844", FR);
  assert.equal(res.ok === true && res.e164, "+33630912844");
  assert.equal(res.ok === true && res.foreign, false);
  // Too few digits to be anyone's international number: judged as French.
  assert.equal(validatePhone("+12345", FR).ok === false, true);
  const short = validatePhone("+12345", FR);
  assert.equal(short.ok === false && short.reason, "short");
});

test("Hungary dials a two-digit trunk prefix", () => {
  const hu = countryFor("HU")!;
  const local = validatePhone("06 30 123 4567", hu);
  assert.equal(local.ok, true);
  assert.equal(local.ok === true && local.e164, "+36301234567");
  const intl = validatePhone("+36 30 123 4567", hu);
  assert.equal(intl.ok === true && intl.e164, "+36301234567");
  // The single trunk 0 of every other country is untouched.
  assert.equal(normalisePhone("0630912844", FR), "630912844");
});

test("PHONE_TEXT carries the new lines in both languages", () => {
  for (const lang of ["fr", "en"] as const) {
    const copy = PHONE_TEXT[lang];
    for (const key of ["shape", "intl", "foreignOk", "country", "search", "searchLabel"] as const) {
      assert.equal(typeof copy[key], "string", `${lang}.${key}`);
      assert.ok(copy[key].length > 0, `${lang}.${key} is empty`);
      assert.ok(!copy[key].includes("—"), `no em dash allowed: ${lang}.${key}`);
    }
  }
  // French is the primary language of the site: it must not read as English.
  assert.notEqual(PHONE_TEXT.fr.country, PHONE_TEXT.en.country);
  assert.notEqual(PHONE_TEXT.fr.searchLabel, PHONE_TEXT.en.searchLabel);
});

// Mirror of what PhoneField puts in the two hidden fields and in the number
// input at submit time. The call sites post `dialcode` + " " + `phoneNumber`
// and were not changed, so those two fields have to be right on their own:
// this is the trunk-0 half of the 17 Sep 2026 incident.
function posted(raw: string, country: Country): string | null {
  const res = validatePhone(raw, country);
  if (!res.ok) return null; // the field blocks the submit
  const dial = res.foreign ? "" : country.dial; // hidden "dialcode"
  const num = res.foreign ? res.e164 : res.national; // "phoneNumber" at submit
  return `${dial} ${num}`.trim();
}

test("the phone the form posts is callable", () => {
  assert.equal(posted("06 30 91 28 44", FR), "+33 630912844");
  assert.equal(posted("0630912844", FR), "+33 630912844");
  assert.equal(posted("+33 6 30 91 28 44", FR), "+33 630912844");
  assert.equal(posted("418 717 2114", CA), "+1 4187172114");
  assert.equal(posted("07911 123456", GB), "+44 7911123456");
  assert.equal(posted("+55 11 98765 4321", FR), "+5511987654321");
  // The incident itself: never posted at all.
  assert.equal(posted("+33 4187172114", FR), null);
  assert.equal(posted("0630912844", CA), null);
});

// ---------------------------------------------------------------------------
// The server-side guard. The field blocks a bad number in the browser; this is
// the same check on /api/book and /api/contact, for anything that arrives
// another way (a script, a page cached before the fix, the check-up hand-off).
// ---------------------------------------------------------------------------

test("the server guard repairs what an older page posted", () => {
  // Before the fix the forms posted the dial code plus the raw typed number,
  // trunk 0 and all. Those numbers are callable once the 0 is gone.
  assert.equal(checkPostedPhone("+33 0630912844"), "+33630912844");
  assert.equal(checkPostedPhone("+33 06 30 91 28 44"), "+33630912844");
  assert.equal(checkPostedPhone("+33 630912844"), "+33630912844");
  assert.equal(checkPostedPhone("+1 418 717 2114"), "+14187172114");
  assert.equal(checkPostedPhone("+44 07911 123456"), "+447911123456");
});

test("the server guard turns away a number the country cannot have", () => {
  assert.equal(checkPostedPhone("+33 4187172114"), null); // the 17 Sep 2026 lead
  assert.equal(checkPostedPhone("+33 12345"), null);
  assert.equal(checkPostedPhone("+1 0630912844"), null); // no NANP code starts with 0
  assert.equal(checkPostedPhone("+33"), null);
});

test("the server guard needs a dial code to check against", () => {
  for (const raw of ["0630912844", "630912844", "", "   ", "not a phone"]) {
    assert.equal(checkPostedPhone(raw), null, `expected ${JSON.stringify(raw)} to be refused`);
  }
  assert.equal(checkPostedPhone(null), null);
  assert.equal(checkPostedPhone(undefined), null);
  assert.equal(checkPostedPhone(42), null);
});

test("the server guard keeps a number from the rest of the world", () => {
  // The picker carries 32 countries; everyone else types the full number.
  assert.equal(checkPostedPhone("+5511987654321"), "+5511987654321");
  assert.equal(checkPostedPhone("+972 50 123 4567"), "+972501234567");
  assert.equal(checkPostedPhone("+81 3 1234 5678"), "+81312345678");
});

test("the server guard agrees with what the field posts", () => {
  // Whatever `posted()` above lets through must survive the route untouched,
  // otherwise a lead the form accepted would be refused on arrival.
  const cases: [string, Country][] = [
    ["06 30 91 28 44", FR],
    ["0630912844", FR],
    ["+33 6 30 91 28 44", FR],
    ["418 717 2114", CA],
    ["+1 418 717 2114", US],
    ["07911 123456", GB],
    ["+55 11 98765 4321", FR],
  ];
  for (const [raw, country] of cases) {
    const sent = posted(raw, country);
    assert.ok(sent, `expected ${raw} to be posted at all`);
    const back = checkPostedPhone(sent);
    assert.ok(back, `the route refused ${sent}, which the form accepted`);
    assert.equal(back.replace(/\s+/g, ""), sent.replace(/\s+/g, ""), `mismatch for ${raw}`);
  }
});

// ---------------------------------------------------------------------------
// The tolerant repair. The check-up's phone question was a plain text input
// until 18 Sep 2026: it stored whatever was typed, and a page cached before
// the fix still posts that way. `repairPostedPhone` never throws and never
// refuses — the enquiry must survive whatever arrives.
// ---------------------------------------------------------------------------

test("the 18 Sep 2026 lead: a North American number typed with its trunk 1", () => {
  // Stored as "15817015976" — +1 581 701 5976, Quebec (581 overlays 418).
  assert.equal(repairPostedPhone("15817015976"), "+15817015976");
  assert.equal(repairPostedPhone("1 581 701 5976"), "+15817015976");
  assert.equal(repairPostedPhone("1-581-701-5976"), "+15817015976");
  assert.equal(repairPostedPhone("(581) 701-5976", { country: "CA" }), "+15817015976");
});

test("the repair keeps a number it cannot place exactly as typed", () => {
  // Ten digits and no country: Quebec reads them as 418 717 2114, France as a
  // number starting 41. Guessing is what filed the last three leads wrong.
  assert.equal(repairPostedPhone("4187172114"), "4187172114");
  assert.equal(repairPostedPhone("0630912844"), "0630912844");
  assert.equal(repairPostedPhone("630912844"), "630912844");
  // The 17 Sep 2026 lead is still refused: no country can have it, so it is
  // never turned into something that looks callable.
  assert.equal(checkPostedPhone("+33 4187172114"), null);
  assert.equal(repairPostedPhone("+33 4187172114"), "+33 4187172114");
});

test("the repair uses a country hint when the client gives one", () => {
  assert.equal(repairPostedPhone("0630912844", { country: "FR" }), "+33630912844");
  assert.equal(repairPostedPhone("06 30 91 28 44", { country: "fr" }), "+33630912844");
  assert.equal(repairPostedPhone("0630912844", { dial: "+33" }), "+33630912844");
  assert.equal(repairPostedPhone("07911 123456", { country: "GB" }), "+447911123456");
  // A hint the number contradicts decides nothing; the value stays as typed.
  assert.equal(repairPostedPhone("4187172114", { country: "FR" }), "4187172114");
  // An unknown hint is simply no hint.
  assert.equal(repairPostedPhone("0630912844", { country: "ZZ" }), "0630912844");
});

test("the repair passes an international number through the existing guard", () => {
  assert.equal(repairPostedPhone("+33 0630912844"), "+33630912844");
  assert.equal(repairPostedPhone("+1 418 717 2114"), "+14187172114");
  assert.equal(repairPostedPhone("0033 6 30 91 28 44"), "+33630912844");
  assert.equal(repairPostedPhone("+5511987654321"), "+5511987654321");
});

test("the repair never throws and never invents a number", () => {
  const junk = "x".repeat(50);
  assert.equal(repairPostedPhone(junk), junk);
  assert.equal(repairPostedPhone("!@#$%^&*()".repeat(5)).length, 50);
  assert.equal(repairPostedPhone("call me at the shop please ok"), "call me at the shop please ok");
  assert.equal(repairPostedPhone("1".repeat(50)), "1".repeat(50));
  assert.equal(repairPostedPhone(""), "");
  assert.equal(repairPostedPhone("   "), "");
  assert.equal(repairPostedPhone(null), "");
  assert.equal(repairPostedPhone(undefined), "");
  assert.equal(repairPostedPhone(42), "42");
  assert.equal(repairPostedPhone({}), "[object Object]");
});

test("what the check-up posts now survives the repair untouched", () => {
  // The wizard publishes E.164; the route must not rewrite it.
  for (const e164 of ["+15817015976", "+33630912844", "+447911123456", "+5511987654321"]) {
    assert.equal(repairPostedPhone(e164), e164);
  }
});

// ---------------------------------------------------------------------------
// Which country the lead row gets. "FR" was the default for every check-up,
// because the check-up is served in French to the whole world.
// ---------------------------------------------------------------------------

test("the country comes from the dial code when the number carries one", () => {
  assert.equal(countryFromE164("+33630912844"), "FR");
  assert.equal(countryFromE164("+447911123456"), "GB");
  assert.equal(countryFromE164("+32 470 12 34 56"), "BE");
  assert.equal(countryFromE164("+352 621 123 456"), "LU"); // +352 before +35…
});

test("+1 is split between Canada and the United States by its area code", () => {
  assert.equal(countryFromE164("+15817015976"), "CA"); // 581 — Quebec
  assert.equal(countryFromE164("+14187172114"), "CA"); // 418 — Quebec
  assert.equal(countryFromE164("+15145551234"), "CA"); // 514 — Montreal
  assert.equal(countryFromE164("+12125551234"), "US"); // 212 — New York
});

test("the country is null when the number does not say, and the caller keeps its default", () => {
  for (const raw of ["0630912844", "4187172114", "15817015976", "", "   ", "not a phone"]) {
    assert.equal(countryFromE164(raw), null, `expected no country for ${JSON.stringify(raw)}`);
  }
  assert.equal(countryFromE164(null), null);
  assert.equal(countryFromE164(undefined), null);
  assert.equal(countryFromE164("+5511987654321"), null); // Brazil is not in the picker
  assert.equal(countryFromE164("+1581701"), null); // not a whole NANP number
});

test("a dial code over digits that do not fit it names no country at all", () => {
  // Jojo's row: a Quebec number typed under +33. France has nine digits after
  // the dial code and this has ten, so the number cannot be rung and may not
  // file the lead under France.
  assert.equal(countryFromE164("+33 4187172114"), null);
  // The same digits with the right dial code do name one.
  assert.equal(countryFromE164("+18732557953"), "CA");
});
