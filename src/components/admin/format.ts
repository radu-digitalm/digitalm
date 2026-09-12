// Formatting helpers for the admin UI (docs/finder-ux-spec.md §6.1): dates in
// Europe/Paris, relative times for lists, kilometres, thousands. Pure —
// Intl only plus fromSql from crm/time.ts (no imports that reach SQLite) — so
// server pages, client components and node --test share one implementation.
import { fromSql } from "../../lib/crm/time.ts";

const TZ = "Europe/Paris";

function parse(s: string | Date | null | undefined): Date | null {
  if (!s) return null;
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  return fromSql(s);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Civil parts of an instant in Europe/Paris (month abbreviations fixed, not ICU's "Sept"). */
function parts(d: Date): { day: number; month: string; year: number; hm: string } {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: Number(get("day")), month: MONTHS[Number(get("month")) - 1] ?? get("month"), year: Number(get("year")), hm: `${get("hour")}:${get("minute")}` };
}

/** "12 Sep 2026, 09:04" in Europe/Paris from a SQL ("YYYY-MM-DD HH:MM:SS" UTC) or ISO string; "" when unset. */
export function localDateTime(s: string | Date | null | undefined): string {
  const d = parse(s);
  if (!d) return "";
  const x = parts(d);
  return `${x.day} ${x.month} ${x.year}, ${x.hm}`;
}

/** "12 Sep 2026" in Europe/Paris; "" when unset. */
export function localDate(s: string | Date | null | undefined): string {
  const d = parse(s);
  if (!d) return "";
  const x = parts(d);
  return `${x.day} ${x.month} ${x.year}`;
}

/** "12 Sep, 09:47" — a short local stamp for lists (no year). */
export function shortDateTime(s: string | Date | null | undefined): string {
  const d = parse(s);
  if (!d) return "";
  const x = parts(d);
  return `${x.day} ${x.month}, ${x.hm}`;
}

/** "just now" / "5 min ago" / "2 h ago" under 24 h, else "12 Sep, 09:47". */
export function relativeOrLocal(s: string | Date | null | undefined, now: Date = new Date()): string {
  const d = parse(s);
  if (!d) return "";
  const diff = now.getTime() - d.getTime();
  if (diff >= 0 && diff < 86_400_000) {
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    return `${Math.floor(min / 60)} h ago`;
  }
  return shortDateTime(d);
}

/** Integers with thousands separators: 12,345. */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-GB");
}

/** Kilometres with one decimal (0.4, 16.4, 120.0 → "120"). */
export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return "";
  const r = Math.round(km * 10) / 10;
  return r >= 100 ? String(Math.round(r)) : r.toFixed(1);
}

/** "48 s" / "2 min 10 s" / "1 h 3 min" from milliseconds. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** "40 s" / "3 min" for an ETA in seconds. */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return `${Math.round(seconds / 60)} min`;
}

/** "France" from "FR" (Intl.DisplayNames, English); the code itself when unknown. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  const c = code.toUpperCase();
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" }).of(c);
    return n && n !== c ? n : c;
  } catch {
    return c;
  }
}

/** "postcode town" ("09000 Foix"), or the one that exists. */
export function townLine(postcode: string | null | undefined, city: string | null | undefined): string {
  return [postcode, city].filter(Boolean).join(" ");
}

/** "Foix (09000)" for headers. */
export function townParen(postcode: string | null | undefined, city: string | null | undefined): string {
  if (city && postcode) return `${city} (${postcode})`;
  return city ?? postcode ?? "";
}

/** Bare domain for display: "https://www.example.fr/a" → "example.fr". */
export function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? url;
  }
}

/** "3 businesses" / "1 business". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

const DAY_WORDS: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "public holidays", SH: "school holidays" };

/**
 * OpenStreetMap opening_hours in plain words, lightly: day codes become
 * words ("Tu-Su 12:00-14:00,19:00-22:00; Mo off" → "Tue–Sun 12:00–14:00,
 * 19:00–22:00 · Mon closed"). Anything unusual is left as written.
 */
export function openingHoursWords(s: string | null | undefined): string {
  if (!s) return "";
  const rules = s
    .split(";")
    .map((r) => r.trim())
    .filter(Boolean);
  return rules
    .map((rule) => {
      let t = rule.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b/g, (d) => DAY_WORDS[d] ?? d);
      t = t.replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, "$1–$2").replace(/,(?=\d{2}:\d{2})/g, ", ");
      t = t.replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)-(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/g, "$1–$2");
      t = t.replace(/\boff\b/g, "closed").replace(/\b24\/7\b/g, "24 hours a day");
      return t;
    })
    .join(" · ");
}

/** "Alzimut Alzen" → a Google web search URL (plain link, new tab). */
export function googleSearchUrl(...terms: (string | null | undefined)[]): string {
  const q = terms
    .map((t) => (t ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
