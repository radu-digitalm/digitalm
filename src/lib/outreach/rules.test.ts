import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES, callWindowStatus, countryAllowList, emailEnabled, localClock, ruleFor, ruleKeyFor } from "./rules.ts";
import type { SendRule } from "../crm/types.ts";

test("rule table: FR / GB / US rows match the contract, everything else is the * row", () => {
  const fr = RULES.FR;
  assert.equal(fr.emailAllowed, true);
  assert.equal(fr.soleTraderEmail, "allowed_with_notice");
  assert.equal(fr.unknownLegalFormEmail, "allowed");
  assert.equal(fr.requiresPostalAddress, false);
  assert.equal(fr.requiresAdIdentification, false);
  assert.equal(fr.optOutHonourDays, 0);
  assert.equal(fr.footer, "fr");
  assert.equal(fr.defaultLocale, "fr");
  assert.equal(fr.callAllowed, true);
  assert.equal(fr.callWindow.tz, "Europe/Paris");
  assert.deepEqual(fr.callWindow.ranges, [["10:00", "13:00"], ["14:00", "20:00"]]);

  const gb = RULES.GB;
  assert.equal(gb.soleTraderEmail, "consent_required");
  assert.equal(gb.unknownLegalFormEmail, "call_only");
  assert.equal(gb.footer, "en_uk");
  assert.equal(gb.callAllowed, "screened");
  assert.equal(gb.callWindow.tz, "Europe/London");
  assert.deepEqual(gb.callWindow.ranges, [["09:00", "17:30"]]);

  const us = RULES.US;
  assert.equal(us.requiresPostalAddress, true);
  assert.equal(us.requiresAdIdentification, true);
  assert.equal(us.optOutHonourDays, 10);
  assert.equal(us.footer, "en_us");
  assert.equal(us.callWindow.tz, "America/New_York");

  const any = RULES["*"];
  assert.equal(any.emailAllowed, false);
  assert.equal(any.soleTraderEmail, "blocked");
  assert.equal(any.unknownLegalFormEmail, "call_only");
  assert.equal(any.callAllowed, "manual");
  assert.deepEqual(any.callWindow, gb.callWindow);

  for (const r of Object.values(RULES) as SendRule[]) {
    assert.equal(r.noticeDeadlineDays, 30);
    assert.equal(r.reEmailAfterDays, 90);
    assert.equal(r.auditMaxAgeDays, 90);
    assert.equal(r.maxEmailsPer90d, 2);
    assert.equal(r.maxCallAttempts30d, 4);
    assert.deepEqual(r.callWindow.days, [1, 2, 3, 4, 5]);
  }
});

test("ruleFor / ruleKeyFor: case-insensitive, unknown → *", () => {
  assert.equal(ruleKeyFor("fr"), "FR");
  assert.equal(ruleKeyFor(" gb "), "GB");
  assert.equal(ruleKeyFor("CA"), "*");
  assert.equal(ruleKeyFor(null), "*");
  assert.equal(ruleFor("DE").country, "*");
  assert.equal(ruleFor("US").country, "US");
});

test("countryAllowList: default FR,GB,US; junk dropped; blank → default", () => {
  assert.deepEqual([...countryAllowList(undefined)], ["FR", "GB", "US"]);
  assert.deepEqual([...countryAllowList("")], ["FR", "GB", "US"]);
  assert.deepEqual([...countryAllowList("fr, gb ,xx1,US,CA")], ["FR", "GB", "US", "CA"]);
});

test("emailEnabled: the env can only restrict — CA stays blocked even when listed", () => {
  const all = countryAllowList("FR,GB,US,CA");
  assert.equal(emailEnabled("FR", all), true);
  assert.equal(emailEnabled("GB", all), true);
  assert.equal(emailEnabled("US", all), true);
  assert.equal(emailEnabled("CA", all), false);
  assert.equal(emailEnabled("DE", all), false);
  const frOnly = countryAllowList("FR");
  assert.equal(emailEnabled("GB", frOnly), false);
  assert.equal(emailEnabled("fr", frOnly), true);
});

test("localClock / callWindowStatus: Paris hours, lunch break, weekends, London", () => {
  // Thursday 10 Sep 2026 11:30 UTC = 13:30 Paris (lunch break) = 12:30 London.
  const lunch = new Date("2026-09-10T11:30:00Z");
  assert.deepEqual(localClock("Europe/Paris", lunch), { weekday: 4, localTime: "13:30" });
  const paris = callWindowStatus(RULES.FR.callWindow, lunch);
  assert.equal(paris.open, false);
  assert.equal(paris.localTime, "13:30");
  assert.equal(paris.hours, "10:00–13:00, 14:00–20:00");
  assert.equal(callWindowStatus(RULES.GB.callWindow, lunch).open, true);

  // 15:00 UTC = 17:00 Paris (open) = 16:00 London (open) = 11:00 New York (open).
  const afternoon = new Date("2026-09-10T15:00:00Z");
  assert.equal(callWindowStatus(RULES.FR.callWindow, afternoon).open, true);
  assert.equal(callWindowStatus(RULES.GB.callWindow, afternoon).open, true);
  assert.equal(callWindowStatus(RULES.US.callWindow, afternoon).open, true);

  // Range end is exclusive: 17:30 London is closed, 17:29 is open.
  assert.equal(callWindowStatus(RULES.GB.callWindow, new Date("2026-09-10T16:30:00Z")).open, false);
  assert.equal(callWindowStatus(RULES.GB.callWindow, new Date("2026-09-10T16:29:00Z")).open, true);

  // Saturday 12 Sep 2026 09:00 UTC = 11:00 Paris — closed by weekday.
  const saturday = new Date("2026-09-12T09:00:00Z");
  assert.equal(callWindowStatus(RULES.FR.callWindow, saturday).weekday, 6);
  assert.equal(callWindowStatus(RULES.FR.callWindow, saturday).open, false);

  // Winter: Wednesday 14 Jan 2026 09:30 UTC = 10:30 Paris (open), 04:30 New York (closed).
  const winter = new Date("2026-01-14T09:30:00Z");
  assert.equal(callWindowStatus(RULES.FR.callWindow, winter).open, true);
  assert.equal(callWindowStatus(RULES.US.callWindow, winter).localTime, "04:30");
  assert.equal(callWindowStatus(RULES.US.callWindow, winter).open, false);
});
