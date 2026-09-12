// The finder's notes catalogue (docs/finder-ux-spec.md §3.6): the single
// source of wording for everything the search reports back. Codes are stable
// (the UI keys on them); the text is plain English with no internal jargon —
// notes.test.ts asserts every code has text and none contains a forbidden token.
import type { SearchNote } from "../crm/types.ts";

export type NoteParams = Record<string, string | number>;

export const NOTE_CODES = [
  "register_not_france",
  "register_no_code",
  "ch_off",
  "capped",
  "units_failed",
  "unit_truncated",
  "register_pages_capped",
  "register_outside_dropped",
  "register_failed",
  "google_off",
  "estimate_unknown",
  "interrupted",
  "expired",
  "time_limit",
  "ch_needs_town",
  "country_assumed",
  "duplicates_removed",
  // finder-google (docs/finder-google-spec.md §4.8), codes 17–25
  "google_no_key",
  "google_discovery_off",
  "google_failed",
  "google_refused",
  "google_allowance",
  "google_incomplete",
  "google_outside_dropped",
  "google_matched",
  "google_all_parts",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

export const MAX_LIST = 6;

/** "1,234" — en-GB thousands separators. */
export function fmtNum(n: number | string | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB") : String(n ?? "");
}

/** At most six labels, then "…". */
export function listOf(labels: readonly string[]): string {
  const shown = labels.slice(0, MAX_LIST);
  return labels.length > MAX_LIST ? `${shown.join(", ")}, …` : shown.join(", ");
}

/** Lower-case plural of a trade label ("Restaurant" → "restaurants", "Bakery" → "bakeries", "Bar / pub" → "bars / pubs"). */
export function plural(trade: string): string {
  const one = (w: string) => {
    const t = w.trim();
    if (!t) return t;
    if (/[^aeiou]y$/i.test(t)) return `${t.slice(0, -1)}ies`;
    if (/(s|x|z|ch|sh)$/i.test(t)) return `${t}es`;
    return `${t}s`;
  };
  return trade
    .toLowerCase()
    .split(" / ")
    .map(one)
    .join(" / ");
}

const s = (p: NoteParams, k: string) => String(p[k] ?? "");

export const NOTE_TEXT: Record<NoteCode, (p: NoteParams) => string> = {
  register_not_france: (p) => `French company register not searched — ${s(p, "area")} is not in France.`,
  register_no_code: () => "French company register not searched for this trade (no activity code).",
  ch_off: () => "Companies House not searched (no API key).",
  capped: (p) =>
    `Showing ${fmtNum(p.cap)}${p.expected === undefined || p.expected === null || p.expected === "" ? "" : ` of about ${fmtNum(p.expected)}`} ${s(p, "trade")} in ${s(p, "area")} — the ones nearest the centre of ${s(p, "area")} (${fmtNum(p.done)} of ${fmtNum(p.total)} areas: ${s(p, "list")}). Search a smaller area for full coverage.`,
  units_failed: (p) => `Some areas could not be searched because the map service was busy: ${s(p, "list")}. Use “Retry the missing areas”.`,
  unit_truncated: (p) => `${s(p, "unit")} has more than 5,000 ${s(p, "trade")}; the first 5,000 were read.`,
  register_pages_capped: (p) => `The register lists ${fmtNum(p.total)} ${s(p, "trade")} in ${s(p, "scope")}; the first 1,000 were checked.`,
  register_outside_dropped: (p) => `${fmtNum(p.n)} register entries fell outside ${s(p, "area")} and were left out.`,
  register_failed: (p) => `The French company register could not be searched (it ${s(p, "reason")}). Businesses found on the map are shown without register details.`,
  google_off: () => "Google is switched off for now.",
  estimate_unknown: () => "The map service could not say how many to expect before the search — the count grows as areas finish.",
  interrupted: () => "This search was interrupted (the server restarted). Continue to finish it.",
  expired: () => "This search is more than a day old and its results were cleared. Run it again.",
  time_limit: (p) => `The search stopped after ${fmtNum(p.minutes)} minutes (${fmtNum(p.done)} of ${fmtNum(p.total)} areas). Continue to finish it.`,
  ch_needs_town: () => "Companies House is searched by town — search a UK town to include it.",
  country_assumed: (p) => `Country assumed from the search area for ${fmtNum(p.n)} businesses without an address country.`,
  duplicates_removed: (p) => `${fmtNum(p.n)} duplicates removed — the same business listed more than once on the map or in the register.`,
  google_no_key: () => "Google is switched on, but its key is missing.",
  google_discovery_off: () => "Google is used for the map, place suggestions and listing checks, not yet to find businesses.",
  google_failed: () => "Google did not answer, so nothing from Google is shown for this search.",
  google_refused: () => "Google refused the request — the key's restrictions need a look.",
  google_allowance: () => "The monthly Google search allowance is used up — Google was not asked for this search; what is left is reserved for listing checks.",
  google_incomplete: (p) => `Google was asked for ${fmtNum(p.done)} of ${fmtNum(p.total)} parts of ${s(p, "area")}; some businesses known only to Google may be missing.`,
  google_outside_dropped: (p) => `${fmtNum(p.n)} Google results outside ${s(p, "area")} were left out.`,
  google_matched: (p) => `${fmtNum(p.matched)} also on Google · ${fmtNum(p.only)} only on Google.`,
  google_all_parts: (p) => `Google was asked about the whole of ${s(p, "area")}, not only the parts this search covered.`,
};

/** A note with its text rendered from the catalogue; `params` are echoed for the UI. */
export function note(code: NoteCode, params: NoteParams = {}): SearchNote {
  const text = NOTE_TEXT[code](params);
  return Object.keys(params).length > 0 ? { code, text, params } : { code, text };
}

/**
 * Words that must never appear in anything the admin reads (finder-ux §7;
 * finder-google §3.8 adds "claimed", "Google My Business" and "GMB" — not
 * "verified", whose substring would catch the `unverified` status token).
 */
export const FORBIDDEN_TOKENS = ["OSM", "FR reg", "http_", "GOOGLE_PLACES", "tile", "partial", "Nominatim", "Overpass", "caveat", "ISO2", "claimed", "Google My Business", "GMB"] as const;

export function hasForbiddenToken(text: string): string | null {
  const lower = text.toLowerCase();
  for (const t of FORBIDDEN_TOKENS) if (lower.includes(t.toLowerCase())) return t;
  return null;
}
