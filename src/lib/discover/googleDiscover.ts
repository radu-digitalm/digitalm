// The Google phase of a search (docs/finder-google-spec.md §4.3) — only with
// GOOGLE_PLACES_DISCOVERY=on. Tiles of the area (our polygon clips them),
// Text Search Pro per tile with paging and saturation splitting — or one
// Nearby / biased Text Search for a circle area —, the address-only inside
// filter, the name + distance match against the OpenStreetMap and register
// rows. What leaves this module: row patches `{ googlePlaceId }`, anonymous
// pins `{ placeId, lat, lng, fetchedAt }`, counts and notes. Names and
// addresses live only inside this function's frame and are gone when it
// returns; nothing is cached (apiCache is never imported) and nothing from a
// response body is logged.
import type { Category, GooglePin, GoogleProgress, ResolvedArea, SearchNote } from "@/lib/crm/types";
import { haversineM } from "@/lib/crm/classify";
import { GOOGLE_SEARCH_RESERVE, GoogleError, googleFetch, googleUsage } from "./google";
import { googleInside } from "./googleInside";
import { matchPlace, type MatchRow } from "./googleMatch";
import { MASK_SEARCH_PRO, googleTradeFor, languageFor, parseSearch, regionFor, textSearchBody, type GooglePlace } from "./googleRequests";
import { PAGES_PER_TILE, circleRadiusM, circleRequest, initialTiles, isSaturated, splitTile, type Tile } from "./googleTiles";
import { note } from "./notes";
import type { Bbox } from "./polygon";

const MAX_STRIKES = 3;

export type DiscoverInput = {
  area: ResolvedArea;
  category: Category;
  expected: number | null;
  osmRows: readonly MatchRow[];
  registerRows: readonly MatchRow[];
  /** A capped search: only the parts these boxes cover (unit bboxes). Undefined = the whole area. */
  ran?: readonly Bbox[];
  signal: AbortSignal;
  /** Requests this search may spend (GOOGLE_SEARCH_MAX_REQUESTS). */
  budget: number;
  onProgress?: (p: GoogleProgress) => void;
};

export type DiscoverOutput = {
  patches: Map<string, { googlePlaceId: string }>;
  pins: GooglePin[];
  progress: GoogleProgress;
  notes: SearchNote[];
};

function initialGoogleProgress(): GoogleProgress {
  return { state: "running", tiles: 0, tilesDone: 0, requests: 0, found: 0, matched: 0, only: 0, dropped: 0, pinsVersion: 0 };
}

function failureOf(code: GoogleError["code"]): GoogleProgress["error"] {
  if (code === "busy" || code === "timeout" || code === "network" || code === "refused" || code === "allowance") return code;
  return "network";
}

export async function googleDiscover(input: DiscoverInput): Promise<DiscoverOutput> {
  const { area, category, signal } = input;
  const progress = initialGoogleProgress();
  const notes: SearchNote[] = [];
  const patches = new Map<string, { googlePlaceId: string }>();
  const pins: GooglePin[] = [];
  const seen = new Set<string>();
  const trade = googleTradeFor(category);
  const lang = languageFor(area.countryCode);
  const region = regionFor(area.countryCode);
  const strip = [category.label.fr, category.label.en];
  const report = () => input.onProgress?.({ ...progress });

  const finish = (state: GoogleProgress["state"], error?: GoogleProgress["error"]): DiscoverOutput => {
    progress.state = state;
    if (error) progress.error = error;
    else delete progress.error;
    progress.pinsVersion = 1;
    if (state === "done") {
      notes.push(note("google_matched", { matched: progress.matched, only: progress.only }));
      if (progress.dropped > 0) notes.push(note("google_outside_dropped", { n: progress.dropped, area: area.label }));
    }
    return { patches, pins, progress, notes };
  };

  const fail = (code: GoogleError["code"]): DiscoverOutput => {
    const error = failureOf(code);
    if (error === "allowance") notes.push(note("google_allowance"));
    else if (error === "refused") notes.push(note("google_refused"));
    else notes.push(note("google_failed"));
    return finish("failed", error);
  };

  const consume = (places: readonly GooglePlace[], fetchedAt: string, keepM?: number) => {
    for (const p of places) {
      if (seen.has(p.placeId)) continue;
      seen.add(p.placeId);
      if (keepM !== undefined && p.lat !== null && p.lng !== null && haversineM(area.center, { lat: p.lat, lng: p.lng }) > keepM) {
        progress.dropped++;
        continue;
      }
      if (googleInside(p, area) === "no") {
        progress.dropped++;
        continue;
      }
      progress.found++;
      const hit = matchPlace(p, input.osmRows, { stripWords: strip }) ?? matchPlace(p, input.registerRows, { stripWords: strip });
      if (hit) {
        progress.matched++;
        if (!patches.has(hit.key)) patches.set(hit.key, { googlePlaceId: p.placeId });
        continue;
      }
      if (p.lat === null || p.lng === null) continue;
      progress.only++;
      pins.push({ placeId: p.placeId, lat: p.lat, lng: p.lng, fetchedAt });
    }
  };

  // The reserve: what is left of the search pool belongs to listing checks and manual matches.
  const usage = googleUsage();
  if (usage.searches.used >= usage.searches.cap - GOOGLE_SEARCH_RESERVE) return fail("allowance");

  let strikes = 0;
  const request = async (path: string, body: unknown): Promise<unknown> => {
    progress.requests++;
    return googleFetch<unknown>("search", path, { body, mask: MASK_SEARCH_PRO, signal, retry: true, reserve: GOOGLE_SEARCH_RESERVE });
  };

  // ---- circle areas: one request ------------------------------------------------------
  if (area.kind === "place" || area.areaSelector.kind === "around") {
    progress.tiles = 1;
    report();
    const req = circleRequest(area, trade, lang, region);
    try {
      const json = await request(req.path, req.body);
      const fetchedAt = new Date().toISOString();
      consume(parseSearch(json).places, fetchedAt, req.kind === "text" ? circleRadiusM(area) : undefined);
      progress.tilesDone = 1;
      report();
      return finish("done");
    } catch (e) {
      if (signal.aborted || (e instanceof GoogleError && e.code === "aborted")) return finish("skipped");
      return fail(e instanceof GoogleError ? e.code : "unavailable");
    }
  }

  // ---- everything else: tiles, three pages each, quadrants when saturated ----------------
  const queue: Tile[] = initialTiles(area, input.expected, input.ran);
  progress.tiles = queue.length;
  report();
  while (queue.length > 0) {
    if (signal.aborted) return finish("skipped");
    if (progress.requests >= input.budget) {
      notes.push(note("google_incomplete", { done: progress.tilesDone, total: progress.tilesDone + queue.length, area: area.label }));
      progress.tiles = progress.tilesDone + queue.length;
      return finish("done");
    }
    const tile = queue.shift()!;
    let token: string | null = null;
    let pages = 0;
    let results = 0;
    let tileFailed = false;
    while (pages < PAGES_PER_TILE && progress.requests < input.budget) {
      const body = textSearchBody({ textQuery: trade.query[lang], includedType: trade.includedType, rect: tile.rect, languageCode: lang, regionCode: region, pageToken: token });
      try {
        const json = await request("/v1/places:searchText", body);
        pages++;
        const fetchedAt = new Date().toISOString();
        const parsed = parseSearch(json);
        results += parsed.places.length;
        consume(parsed.places, fetchedAt);
        token = parsed.nextPageToken;
        if (!token) break;
      } catch (e) {
        if (signal.aborted || (e instanceof GoogleError && e.code === "aborted")) return finish("skipped");
        const code = e instanceof GoogleError ? e.code : "unavailable";
        if (code === "allowance" || code === "refused" || code === "off" || code === "no_key" || code === "mask_tier") return fail(code);
        strikes++;
        if (strikes >= MAX_STRIKES) return fail(code);
        tileFailed = true;
        break;
      }
    }
    progress.tilesDone++;
    if (!tileFailed && isSaturated(pages, results, token)) {
      const quads = splitTile(tile);
      queue.push(...quads);
    }
    progress.tiles = progress.tilesDone + queue.length;
    report();
  }
  return finish("done");
}
