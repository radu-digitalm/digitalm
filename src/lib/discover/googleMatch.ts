// Matching a Google place to a row we already have (docs/finder-google-spec.md
// §4.3 "Matching", §4.5 save-time match): the names must agree — the same
// normalised key, or a token overlap ≥ 0.6 once the trade words are stripped —
// and the places must agree: within 150 m when the row has source
// coordinates (300 m for a saved prospect), or the same postcode when it has
// none (register rows sit at the area centre). The nearest candidate wins. A
// distance from one point is allowed by the terms; nothing here is a polygon
// test. Pure: classify.ts only.
import { haversineM, normaliseName } from "../crm/classify.ts";

export const MATCH_MAX_M = 150;
export const PROSPECT_MATCH_MAX_M = 300;
export const TOKEN_OVERLAP_MIN = 0.6;
export const MIN_TOKEN_CHARS = 3;

/** Words that carry no identity: the generic trade nouns and legal forms. Category labels are added per search. */
export const GENERIC_WORDS = ["restaurant", "bar", "hotel", "hôtel", "salon", "garage", "cabinet", "sarl", "sas", "eurl"] as const;

export type MatchRow = { key: string; name: string; lat?: number; lng?: number; geoSource: "source" | "centre" | "none" | "manual" | null; postcode?: string | null };
export type MatchPlace = { placeId: string; name: string; lat: number | null; lng: number | null; postcode: string | null };
export type MatchOptions = { maxM?: number; stripWords?: readonly string[] };

function tokensOf(name: string): string[] {
  return normaliseName(name).split(" ").filter(Boolean);
}

/** Identity tokens of a name: ≥ 3 chars, generic words and the given trade words removed. */
export function nameTokens(name: string, stripWords: readonly string[] = []): Set<string> {
  const strip = new Set<string>();
  for (const w of [...GENERIC_WORDS, ...stripWords]) for (const t of tokensOf(w)) strip.add(t);
  return new Set(tokensOf(name).filter((t) => t.length >= MIN_TOKEN_CHARS && !strip.has(t)));
}

/** Jaccard overlap of the identity tokens; 0 when either side has none. */
export function tokenOverlap(a: string, b: string, stripWords: readonly string[] = []): number {
  const ta = nameTokens(a, stripWords);
  const tb = nameTokens(b, stripWords);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Same name key, or a token overlap ≥ 0.6 after stripping the trade words. */
export function namesAgree(a: string, b: string, stripWords: readonly string[] = []): boolean {
  const ka = normaliseName(a);
  if (ka.length > 0 && ka === normaliseName(b)) return true;
  return tokenOverlap(a, b, stripWords) >= TOKEN_OVERLAP_MIN;
}

function hasPoint(x: { lat?: number | null; lng?: number | null }): x is { lat: number; lng: number } {
  return typeof x.lat === "number" && typeof x.lng === "number" && Number.isFinite(x.lat) && Number.isFinite(x.lng);
}

function samePostcode(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = (a ?? "").replace(/\s+/g, "").toUpperCase();
  return pa.length > 0 && pa === (b ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * The row a place matches, or null. Rows with source (or manual) coordinates
 * must be within `maxM`; rows without must share the postcode; the nearest
 * (then the first) wins. A place matches at most one row.
 */
export function matchPlace(place: MatchPlace, rows: readonly MatchRow[], opts: MatchOptions = {}): { key: string; distanceM: number | null } | null {
  const maxM = opts.maxM ?? MATCH_MAX_M;
  const strip = opts.stripWords ?? [];
  let best: { key: string; distanceM: number | null } | null = null;
  for (const row of rows) {
    if (!row.name || !namesAgree(place.name, row.name, strip)) continue;
    const rowPlaced = (row.geoSource === "source" || row.geoSource === "manual") && hasPoint(row);
    if (rowPlaced && hasPoint(place)) {
      const d = haversineM({ lat: place.lat, lng: place.lng }, { lat: row.lat, lng: row.lng });
      if (d > maxM) continue;
      if (!best || best.distanceM === null || d < best.distanceM) best = { key: row.key, distanceM: Math.round(d) };
    } else if (!rowPlaced) {
      if (!samePostcode(place.postcode, row.postcode)) continue;
      if (!best) best = { key: row.key, distanceM: null };
    }
  }
  return best;
}
