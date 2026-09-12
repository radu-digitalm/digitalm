// Discovery façade (docs/finder-ux-spec.md §4 "Library exports"): area
// resolution, the plan / runner API, reads for the pages and the source
// labels in plain words. The search itself runs in runner.ts, in the
// background of the `next start` process; the routes only resolve, plan,
// start, poll, cancel, continue, dismiss and save.
import type { DiscoverySource, SearchResultV2, SearchSummaryV2 } from "@/lib/crm/types";

export { DiscoverError, resolveArea, finePolygon } from "./geocode";
export type { AreaPick, Candidate, Resolution } from "./geocode";
export { parseCategory, tradeKeyFor, tradeLabel, CATEGORIES } from "./categories";
export type { MergedBusiness } from "./dedupe";
export {
  RunnerError,
  planSearch,
  startSearch,
  continueSearch,
  cancelSearch,
  getSearch,
  sliceResult,
  listSearches,
  searchSummary,
  dismissSearchRow,
  runningSearch,
  orderRows,
} from "./runner";
export type { PlanOutcome, StartInput, StoredPlan } from "./runner";
export { note, NOTE_CODES } from "./notes";
// finder-google (docs/finder-google-spec.md §4.8)
export { GoogleError, googlePlacesOn, googleDiscoveryOn, googleMapConfigured, googleKeyMissing, googleUsage } from "./google";
export { GOOGLE_TYPES, placeIdOk } from "./googleRequests";
export { resolveSuggestion } from "./googleSuggest";

/** Legacy names kept for the components that still import them; the shapes are the v2 ones. */
export type SearchResult = SearchResultV2;
export type SearchSummary = SearchSummaryV2;

export const SOURCE_IDS: readonly DiscoverySource[] = ["osm", "fr_register", "companies_house", "google"];

/** Plain words for every source (never "OSM" / "FR reg." in the UI). */
export const SOURCE_LABELS: Record<DiscoverySource, string> = {
  osm: "OpenStreetMap",
  fr_register: "French company register",
  companies_house: "Companies House",
  google: "Google",
};

/** Sanitise a `sources` field from the request body; unknown → every source. */
export function parseSources(input: unknown): DiscoverySource[] {
  if (!Array.isArray(input)) return [...SOURCE_IDS];
  const out = SOURCE_IDS.filter((s) => input.includes(s));
  return out.length > 0 ? out : [...SOURCE_IDS];
}
