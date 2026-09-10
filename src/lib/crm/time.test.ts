import { test } from "node:test";
import assert from "node:assert/strict";
import { daysSinceSql, daysUntilSql, fromSql, intEnv, nextParisTime, parisDayStartSql, sqlNow, sqlToMs, toSql, zonedDate, zonedDateString, zonedToday } from "./time.ts";

test("toSql / fromSql / sqlToMs round-trip the SQLite shape and reject junk", () => {
  const d = new Date("2026-09-10T14:03:09.500Z");
  assert.equal(toSql(d), "2026-09-10 14:03:09");
  assert.equal(fromSql("2026-09-10 14:03:09")?.toISOString(), "2026-09-10T14:03:09.000Z");
  assert.equal(fromSql("2026-09-10T14:03:09Z")?.toISOString(), "2026-09-10T14:03:09.000Z");
  assert.equal(fromSql(""), null);
  assert.equal(fromSql(null), null);
  assert.equal(fromSql("not a date"), null);
  assert.equal(sqlToMs("2026-09-10 00:00:00"), Date.UTC(2026, 8, 10));
  assert.match(sqlNow(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("daysSinceSql / daysUntilSql: whole days, null when unset", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  assert.equal(daysSinceSql("2026-09-08 11:00:00", now), 2);
  assert.equal(daysSinceSql("2026-09-10 11:59:00", now), 0);
  assert.equal(daysSinceSql(null, now), null);
  assert.equal(daysUntilSql("2026-09-11 12:00:00", now), 1);
  assert.equal(daysUntilSql("2026-09-10 13:00:00", now), 1); // ceil: still "1 day" while ahead
  assert.equal(daysUntilSql("2026-09-05 12:00:00", now), -5);
  assert.equal(daysUntilSql(undefined, now), null);
});

test("zonedDate: Europe/Paris winter and summer offsets", () => {
  assert.equal(zonedDate("Europe/Paris", 2026, 1, 15).toISOString(), "2026-01-14T23:00:00.000Z");
  assert.equal(zonedDate("Europe/Paris", 2026, 7, 15, 6, 30).toISOString(), "2026-07-15T04:30:00.000Z");
  assert.equal(zonedDate("Europe/London", 2026, 7, 15, 9).toISOString(), "2026-07-15T08:00:00.000Z");
  assert.equal(zonedDate("America/New_York", 2026, 1, 15, 9).toISOString(), "2026-01-15T14:00:00.000Z");
});

test("zonedDate: DST edges — the spring gap and the autumn overlap resolve to real instants", () => {
  // 29 March 2026: 02:00 CET jumps to 03:00 CEST; 02:30 does not exist → the instant after the gap.
  const gap = zonedDate("Europe/Paris", 2026, 3, 29, 2, 30);
  assert.equal(gap.toISOString(), "2026-03-29T01:30:00.000Z"); // reads 03:30 CEST
  assert.equal(zonedDate("Europe/Paris", 2026, 3, 29, 1, 30).toISOString(), "2026-03-29T00:30:00.000Z");
  assert.equal(zonedDate("Europe/Paris", 2026, 3, 29, 3, 30).toISOString(), "2026-03-29T01:30:00.000Z");
  // 25 October 2026: 03:00 CEST falls back to 02:00 CET; 02:30 happens twice → one of them, one hour apart from 01:30 and 03:30 bounds.
  const overlap = zonedDate("Europe/Paris", 2026, 10, 25, 2, 30).getTime();
  assert.ok(overlap === Date.parse("2026-10-25T00:30:00Z") || overlap === Date.parse("2026-10-25T01:30:00Z"));
  assert.equal(zonedDate("Europe/Paris", 2026, 10, 25, 0, 0).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(zonedDate("Europe/Paris", 2026, 10, 25, 12, 0).toISOString(), "2026-10-25T11:00:00.000Z");
});

test("zonedToday / zonedDateString: civil date in the zone, not UTC", () => {
  const lateEvening = new Date("2026-09-10T22:30:00Z"); // 00:30 on the 11th in Paris
  assert.deepEqual(zonedToday("Europe/Paris", lateEvening), [2026, 9, 11]);
  assert.equal(zonedDateString("Europe/Paris", lateEvening), "2026-09-11");
  assert.equal(zonedDateString("America/New_York", lateEvening), "2026-09-10");
});

test("parisDayStartSql: midnight Paris as a UTC SQL timestamp, either side of DST", () => {
  assert.equal(parisDayStartSql(new Date("2026-07-15T10:00:00Z")), "2026-07-14 22:00:00");
  assert.equal(parisDayStartSql(new Date("2026-01-15T10:00:00Z")), "2026-01-14 23:00:00");
  assert.equal(parisDayStartSql(new Date("2026-09-10T22:30:00Z")), "2026-09-10 22:00:00"); // already the 11th in Paris
});

test("nextParisTime: strictly after `at`, rolls over midnight and across the DST change", () => {
  assert.equal(nextParisTime(6, 0, new Date("2026-09-10T02:00:00Z")).toISOString(), "2026-09-10T04:00:00.000Z");
  assert.equal(nextParisTime(6, 0, new Date("2026-09-10T04:00:00Z")).toISOString(), "2026-09-11T04:00:00.000Z"); // not strictly after → tomorrow
  assert.equal(nextParisTime(6, 0, new Date("2026-09-10T10:00:00Z")).toISOString(), "2026-09-11T04:00:00.000Z");
  // The evening before the clocks go forward: 06:00 next day is CEST (04:00Z), not CET (05:00Z).
  assert.equal(nextParisTime(6, 0, new Date("2026-03-28T23:00:00Z")).toISOString(), "2026-03-29T04:00:00.000Z");
  // The evening before the clocks go back: 06:00 next day is CET (05:00Z).
  assert.equal(nextParisTime(6, 0, new Date("2026-10-24T22:00:00Z")).toISOString(), "2026-10-25T05:00:00.000Z");
  // Month and year boundaries.
  assert.equal(nextParisTime(6, 0, new Date("2026-12-31T23:30:00Z")).toISOString(), "2027-01-01T05:00:00.000Z");
});

test("intEnv: integers only, blanks / junk / negatives fall back", () => {
  const env = { A: "12", B: "", C: "abc", D: "-3", E: "7.9" };
  assert.equal(intEnv("A", 1, env), 12);
  assert.equal(intEnv("B", 1, env), 1);
  assert.equal(intEnv("C", 1, env), 1);
  assert.equal(intEnv("D", 1, env), 1);
  assert.equal(intEnv("E", 1, env), 7);
  assert.equal(intEnv("MISSING", 5, env), 5);
});
