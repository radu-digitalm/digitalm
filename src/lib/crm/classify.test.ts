import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  classifyEmail,
  countryFromTld,
  domainOf,
  e164Digits,
  hashEmail,
  hashPhone,
  haversineM,
  localeForCountry,
  normaliseEmail,
  normaliseName,
  safeHttpUrl,
  coerceHttpUrl,
  sha256Hex,
  validEmail,
} from "./classify.ts";

test("classifyEmail: webmail beats everything", () => {
  assert.equal(classifyEmail("jean.dupont@gmail.com"), "webmail");
  assert.equal(classifyEmail("contact@orange.fr", { soleTrader: true }), "webmail");
  assert.equal(classifyEmail("boutique@yahoo.co.uk"), "webmail");
  assert.equal(classifyEmail("x@outlook.fr"), "webmail");
  assert.equal(classifyEmail("x@proton.me"), "webmail");
  assert.equal(classifyEmail("x@laposte.net"), "webmail");
  assert.equal(classifyEmail("x@ME.COM"), "webmail");
});

test("classifyEmail: sole trader, generic, named, unknown", () => {
  assert.equal(classifyEmail("paul@martin-plomberie.fr", { soleTrader: true }), "sole_trader");
  assert.equal(classifyEmail("contact@martin-plomberie.fr", { soleTrader: false }), "generic");
  assert.equal(classifyEmail("Reservations@le-fournil.fr"), "generic");
  assert.equal(classifyEmail("resa@le-fournil.fr"), "generic");
  assert.equal(classifyEmail("paul.martin@martin-plomberie.fr", { soleTrader: null }), "named");
  assert.equal(classifyEmail("not an email"), "unknown");
  assert.equal(classifyEmail(""), "unknown");
});

test("validEmail / normaliseEmail", () => {
  assert.equal(validEmail("a@b.fr"), true);
  assert.equal(validEmail("a@b"), false);
  assert.equal(validEmail("a b@c.fr"), false);
  assert.equal(validEmail("a@b.fr,c@d.fr"), false);
  assert.equal(validEmail(`${"a".repeat(250)}@b.fr`), false);
  assert.equal(validEmail(42), false);
  assert.equal(normaliseEmail("  Contact@Example.FR "), "contact@example.fr");
  assert.equal(normaliseEmail("nope"), null);
});

test("safeHttpUrl: http(s) only, no credentials, ≤ 500 chars", () => {
  assert.equal(safeHttpUrl("https://example.fr/contact"), "https://example.fr/contact");
  assert.equal(safeHttpUrl("http://example.fr"), "http://example.fr/");
  assert.equal(safeHttpUrl("  https://example.fr  "), "https://example.fr/");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,hi"), null);
  assert.equal(safeHttpUrl("ftp://example.fr"), null);
  assert.equal(safeHttpUrl("https://user:pw@example.fr"), null);
  assert.equal(safeHttpUrl("https://user@example.fr"), null);
  assert.equal(safeHttpUrl("example.fr"), null);
  assert.equal(safeHttpUrl(`https://example.fr/${"a".repeat(500)}`), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl(""), null);
  assert.equal(coerceHttpUrl("example.fr"), "https://example.fr/");
  assert.equal(coerceHttpUrl("javascript:alert(1)"), null);
});

test("domainOf: registrable domain without www", () => {
  assert.equal(domainOf("https://www.Example.FR/contact"), "example.fr");
  assert.equal(domainOf("https://shop.example.co.uk/"), "example.co.uk");
  assert.equal(domainOf("https://blog.sub.example.com"), "example.com");
  assert.equal(domainOf("http://localhost"), "localhost");
  assert.equal(domainOf("https://192.168.0.1/x"), "192.168.0.1");
  assert.equal(domainOf("javascript:alert(1)"), null);
});

test("countryFromTld / localeForCountry", () => {
  assert.equal(countryFromTld("https://boulangerie.fr"), "FR");
  assert.equal(countryFromTld("https://shop.example.co.uk"), "GB");
  assert.equal(countryFromTld("example.us"), "US");
  assert.equal(countryFromTld("https://example.com"), null);
  assert.equal(countryFromTld("nope"), null);
  assert.equal(localeForCountry("FR"), "fr");
  assert.equal(localeForCountry("fr"), "fr");
  assert.equal(localeForCountry("GB"), "en");
  assert.equal(localeForCountry(null), "en");
});

test("normaliseName: accents, punctuation, legal forms", () => {
  assert.equal(normaliseName("Boulangerie Pâtisserie MARTIN & Fils"), "boulangerie patisserie martin fils");
  assert.equal(normaliseName("SARL Boulangerie Martin"), "boulangerie martin");
  assert.equal(normaliseName("Boulangerie Martin SAS"), "boulangerie martin");
  assert.equal(normaliseName("LE FOURNIL LTD"), "le fournil");
  assert.equal(normaliseName("L'Épicerie d'Élodie"), "l epicerie d elodie");
  assert.equal(normaliseName("SARL"), "sarl");
  assert.equal(normaliseName("Café-Bar   Le  Central"), "cafe bar le central");
});

test("sha256Hex matches node:crypto, including block boundaries and UTF-8", () => {
  const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "x".repeat(1000), "Pâtisserie Élodie — 09000 Ferrières ☕", "contact@digitalm.eu"]) {
    assert.equal(sha256Hex(s), node(s), `mismatch for ${JSON.stringify(s.slice(0, 20))}`);
  }
});

test("hashEmail: case/space-insensitive sha256", () => {
  const expected = createHash("sha256").update("contact@example.fr").digest("hex");
  assert.equal(hashEmail("  Contact@Example.fr "), expected);
  assert.equal(hashEmail("contact@example.fr"), expected);
});

test("hashPhone / e164Digits: national and international forms agree", () => {
  assert.equal(e164Digits("06 12 34 56 78", "FR"), "33612345678");
  assert.equal(e164Digits("+33 6 12 34 56 78"), "33612345678");
  assert.equal(e164Digits("0033612345678"), "33612345678");
  assert.equal(e164Digits("+33 (0)6 12 34 56 78"), "33612345678");
  assert.equal(e164Digits("023 9200 0000", "GB"), "442392000000");
  assert.equal(e164Digits("(503) 555-0100", "US"), "15035550100");
  assert.equal(e164Digits("12345", "FR"), null);
  assert.equal(hashPhone("06 12 34 56 78", "FR"), hashPhone("+33612345678", "GB"));
  assert.equal(hashPhone("+33612345678"), createHash("sha256").update("33612345678").digest("hex"));
  assert.equal(hashPhone("1", "FR"), null);
});

test("haversineM", () => {
  const foix = { lat: 42.9655, lng: 1.6053 };
  const pamiers = { lat: 43.1163, lng: 1.6113 };
  const d = haversineM(foix, pamiers);
  assert.ok(d > 16_000 && d < 17_500, `expected ~16.8 km, got ${d}`);
  assert.equal(haversineM(foix, foix), 0);
});
