// Closing an area suggestion (docs/finder-google-spec.md §4.4): the Area box's
// UI Kit element hands over a place id and nothing else; one Place Details
// Essentials call turns it into coordinates, address components and a kind
// hint, and the geocoder query Nominatim is asked next ("Ariège, France").
// Never retried, ≤ 4 s, counted on the `google_details_other` pool.
import type { AreaKind } from "@/lib/crm/types";
import { GoogleError, googleFetch } from "./google";
import { MASK_DETAILS_ESSENTIALS, parseDetailsEssentials, placeIdOk } from "./googleRequests";

export const SUGGEST_TIMEOUT_MS = 4_000;

export type SuggestionResolution = { query: string; lat: number; lng: number; countryCode: string; kindHint: AreaKind | null };

/** Throws GoogleError (`off`, `no_key`, `allowance`, `refused`, `bad_request`, `busy`, `timeout`, `network`, `unavailable`). */
export async function resolveSuggestion(suggestion: { placeId: string }, opts: { signal?: AbortSignal } = {}): Promise<SuggestionResolution> {
  if (!placeIdOk(suggestion.placeId)) throw new GoogleError("bad_request", "google_details_other");
  const json = await googleFetch<unknown>("details_essentials", `/v1/places/${encodeURIComponent(suggestion.placeId)}?languageCode=en`, {
    method: "GET",
    mask: MASK_DETAILS_ESSENTIALS,
    signal: opts.signal,
    timeoutMs: SUGGEST_TIMEOUT_MS,
  });
  const place = parseDetailsEssentials(json);
  if (!place || !place.query) throw new GoogleError("unavailable", "google_details_other");
  return { query: place.query, lat: place.lat, lng: place.lng, countryCode: place.countryCode, kindHint: place.kindHint };
}
