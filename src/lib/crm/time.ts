// Time helpers shared by the whole CRM. No imports at all, so client
// components, pure modules and node --test can use them without pulling the
// SQLite driver (crm/db.ts) into a bundle. Every CRM timestamp is stored the
// way SQLite's datetime('now') writes it — "YYYY-MM-DD HH:MM:SS" in UTC — so
// string comparisons in SQL stay correct; civil dates (next_action_at, Today)
// are Europe/Paris.

export function toSql(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function sqlNow(): string {
  return toSql(new Date());
}

/** Milliseconds since the epoch for a SQL timestamp (or an ISO string), null when unset/invalid. */
export function sqlToMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function fromSql(s: string | null | undefined): Date | null {
  const ms = sqlToMs(s);
  return ms === null ? null : new Date(ms);
}

/** Whole days elapsed since a SQL timestamp, or null when unset/invalid. */
export function daysSinceSql(sql: string | null | undefined, now = new Date()): number | null {
  const ms = sqlToMs(sql);
  if (ms === null) return null;
  return Math.floor((now.getTime() - ms) / 86_400_000);
}

/** Whole days from now until a SQL timestamp (negative when past; ceil, so "1 day" until tomorrow), null when unset. */
export function daysUntilSql(sql: string | null | undefined, now = new Date()): number | null {
  const ms = sqlToMs(sql);
  if (ms === null) return null;
  return Math.ceil((ms - now.getTime()) / 86_400_000);
}

// ---- time zones -------------------------------------------------------------------

/** Offset of `tz` from UTC, in minutes, at the given instant. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The instant at which the wall clock in `tz` reads y-m-d h:mi. A time that
 * does not exist (the spring-forward gap) resolves to the instant after the
 * gap; an ambiguous time (the autumn overlap) resolves to its first occurrence.
 */
export function zonedDate(tz: string, y: number, m: number, d: number, h = 0, mi = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = tzOffsetMinutes(tz, new Date(guess));
  let result = guess - off * 60_000;
  // One more pass for the DST edges, where the first guess lands on the wrong side.
  off = tzOffsetMinutes(tz, new Date(result));
  result = guess - off * 60_000;
  return new Date(result);
}

/** Today's civil date in `tz` as [y, m, d]. */
export function zonedToday(tz: string, at = new Date()): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return [get("year"), get("month"), get("day")];
}

/** Today's civil date in `tz` as "YYYY-MM-DD" (the shape of next_action_at and Today). */
export function zonedDateString(tz: string, at = new Date()): string {
  const [y, m, d] = zonedToday(tz, at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Start of today, Europe/Paris, as a SQL timestamp (used by the daily send cap). */
export function parisDayStartSql(at = new Date()): string {
  const [y, m, d] = zonedToday("Europe/Paris", at);
  return toSql(zonedDate("Europe/Paris", y, m, d));
}

/** Next occurrence of hh:mm Europe/Paris strictly after `at` (audit cap reschedule). */
export function nextParisTime(hour: number, minute = 0, at = new Date()): Date {
  const [y, m, d] = zonedToday("Europe/Paris", at);
  const today = zonedDate("Europe/Paris", y, m, d, hour, minute);
  if (today.getTime() > at.getTime()) return today;
  return zonedDate("Europe/Paris", y, m, d + 1, hour, minute);
}

// ---- env ---------------------------------------------------------------------------

/** Non-negative integer from the environment, else the fallback (blank, junk and negatives fall back). */
export function intEnv(name: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
