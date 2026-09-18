import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bothTimes,
  formatInZone,
  isValidZone,
  offsetMinutes,
  sameInstantClock,
  zoneCity,
  zoneLabel,
  zoneShort,
} from "./tz.ts";

const SUMMER = new Date("2026-09-25T14:00:00Z"); // Paris +2, Toronto −4
const WINTER = new Date("2026-01-15T14:00:00Z"); // Paris +1, Toronto −5

test("offsetMinutes follows DST in both hemispheres of the Atlantic", () => {
  assert.equal(offsetMinutes("Europe/Paris", SUMMER), 120);
  assert.equal(offsetMinutes("America/Toronto", SUMMER), -240);
  assert.equal(offsetMinutes("Europe/Paris", WINTER), 60);
  assert.equal(offsetMinutes("America/Toronto", WINTER), -300);
  assert.equal(offsetMinutes("UTC", SUMMER), 0);
});

test("sameInstantClock compares wall clocks, not zone ids", () => {
  assert.equal(sameInstantClock("Europe/Paris", "America/Toronto", SUMMER), false);
  assert.equal(sameInstantClock("Europe/Paris", "Europe/Paris", SUMMER), true);
  // Different zone, same clock in Europe.
  assert.equal(sameInstantClock("Europe/Paris", "Europe/Brussels", SUMMER), true);
});

test("zoneCity reads the last IANA segment", () => {
  assert.equal(zoneCity("America/Toronto"), "Toronto");
  assert.equal(zoneCity("Europe/Paris"), "Paris");
  assert.equal(zoneCity("America/New_York"), "New York");
  assert.equal(zoneCity("America/Argentina/Buenos_Aires"), "Buenos Aires");
});

test("zoneShort and zoneLabel name the offset", () => {
  const short = zoneShort("America/Toronto", SUMMER, "fr-FR");
  assert.match(short, /4$/); // "UTC−4" / "GMT-4" depending on ICU
  assert.equal(zoneLabel("America/Toronto", SUMMER, "fr-FR"), `Toronto (${short})`);
});

test("formatInZone shows the same instant on two clocks", () => {
  assert.equal(formatInZone(SUMMER, "Europe/Paris", "fr-FR"), "16:00");
  assert.equal(formatInZone(SUMMER, "America/Toronto", "fr-FR"), "10:00");
});

test("bothTimes flags a visitor in another zone", () => {
  const away = bothTimes(SUMMER, "America/Toronto", "Europe/Paris", "fr-FR");
  assert.deepEqual(away, { local: "10:00", site: "16:00", differ: true });

  const home = bothTimes(SUMMER, "Europe/Paris", "Europe/Paris", "fr-FR");
  assert.equal(home.differ, false);
  assert.equal(home.local, home.site);
});

test("a rubbish zone is treated as the site zone and never throws", () => {
  const junk = "Nope/Not_A_Zone";
  assert.equal(isValidZone(junk), false);
  assert.equal(isValidZone(""), false);
  assert.equal(isValidZone(undefined), false);
  assert.equal(isValidZone("x".repeat(65)), false);

  assert.equal(offsetMinutes(junk, SUMMER), 120); // Paris
  assert.equal(zoneCity(junk), "Paris");
  assert.doesNotThrow(() => zoneShort(junk, SUMMER, "fr-FR"));
  assert.equal(formatInZone(SUMMER, junk, "fr-FR"), "16:00");

  const t = bothTimes(SUMMER, junk, "Europe/Paris", "fr-FR");
  assert.equal(t.differ, false);
  assert.equal(t.local, "16:00");

  // An unusable date must not throw either.
  assert.equal(offsetMinutes("Europe/Paris", new Date("nonsense")), 0);
  assert.equal(formatInZone(new Date("nonsense"), "Europe/Paris", "fr-FR"), "");
});
