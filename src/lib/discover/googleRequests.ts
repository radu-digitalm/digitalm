// Places API (New) requests and answers as pure data (docs/finder-google-spec.md
// §4.2, Appendix A): the three field masks — one per SKU tier the contract
// budgets for —, the request bodies, the parsers that reduce Google's JSON to
// our own shapes (everything else is dropped on the spot), the derived
// listing signals, and the place-id rule. No I/O, relative imports only, so
// googleRequests.test.ts runs it under node --test. Nothing here keeps a
// name, an address or a review beyond the matching step that needs it.
import { haversineM } from "../crm/classify.ts";
import type { AreaKind, Category, GoogleCandidate, GoogleSignals } from "../crm/types.ts";

// ---- field masks (Appendix A tiers) --------------------------------------------------

/** Text / Nearby Search, Pro tier: identity, address, location, types, status. No photos, no Enterprise field. */
export const MASK_SEARCH_PRO =
  "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types,places.primaryType,places.businessStatus,places.pureServiceAreaBusiness,places.attributions,nextPageToken";
/** Place Details, Enterprise tier: the listing-check signals of a saved prospect (1,000 free a month). */
export const MASK_DETAILS_ENTERPRISE = "id,businessStatus,websiteUri,nationalPhoneNumber,regularOpeningHours,rating,userRatingCount,photos,pureServiceAreaBusiness,attributions";
/** Place Details, Essentials tier: closing an area suggestion (10,000 free a month). */
export const MASK_DETAILS_ESSENTIALS = "id,formattedAddress,addressComponents,location,viewport,types";

/** The only masks the client sends — anything else is refused before a socket opens (rule §3.6). */
export const GOOGLE_MASKS: readonly string[] = Object.freeze([MASK_SEARCH_PRO, MASK_DETAILS_ENTERPRISE, MASK_DETAILS_ESSENTIALS]);

export function isKnownMask(mask: string): boolean {
  return GOOGLE_MASKS.includes(mask);
}

// ---- caps ---------------------------------------------------------------------------------

/** One more request fits under `cap` once `reserve` is kept back: `used + 1 <= cap - reserve`. */
export function withinCap(used: number, cap: number, reserve = 0): boolean {
  return used + 1 <= cap - reserve;
}

// ---- trades ------------------------------------------------------------------------------

export type GoogleTrade = { includedType: string | null; query: { fr: string; en: string } };

/** Fixed trades → Table A type (null = text query only) and the text a Text Search gets. */
export const GOOGLE_TYPES: Record<string, GoogleTrade> = {
  restaurant: { includedType: "restaurant", query: { fr: "restaurant", en: "restaurant" } },
  bar: { includedType: "bar", query: { fr: "bar", en: "bar" } },
  hotel: { includedType: "hotel", query: { fr: "hôtel", en: "hotel" } },
  gite: { includedType: "bed_and_breakfast", query: { fr: "chambre d'hôtes", en: "bed and breakfast" } },
  campsite: { includedType: "campground", query: { fr: "camping", en: "campsite" } },
  bakery: { includedType: "bakery", query: { fr: "boulangerie", en: "bakery" } },
  butcher: { includedType: "butcher_shop", query: { fr: "boucherie", en: "butcher" } },
  hairdresser: { includedType: "hair_salon", query: { fr: "coiffeur", en: "hairdresser" } },
  beauty: { includedType: "beauty_salon", query: { fr: "institut de beauté", en: "beauty salon" } },
  garage: { includedType: "car_repair", query: { fr: "garage automobile", en: "car repair" } },
  plumber: { includedType: "plumber", query: { fr: "plombier", en: "plumber" } },
  electrician: { includedType: "electrician", query: { fr: "électricien", en: "electrician" } },
  joiner: { includedType: null, query: { fr: "menuisier", en: "joiner" } },
  painter: { includedType: "painter", query: { fr: "peintre en bâtiment", en: "painter" } },
  roofer: { includedType: "roofing_contractor", query: { fr: "couvreur", en: "roofer" } },
  estate_agent: { includedType: "real_estate_agency", query: { fr: "agence immobilière", en: "estate agent" } },
  optician: { includedType: null, query: { fr: "opticien", en: "optician" } },
  dentist: { includedType: "dentist", query: { fr: "dentiste", en: "dentist" } },
  gym: { includedType: "gym", query: { fr: "salle de sport", en: "gym" } },
};

/** The trade a search sends: the table row, or the custom label as free text. */
export function googleTradeFor(category: Pick<Category, "key" | "label" | "custom">): GoogleTrade {
  const fixed = GOOGLE_TYPES[category.key];
  if (fixed && !category.custom) return fixed;
  return { includedType: null, query: { fr: category.label.fr, en: category.label.en } };
}

const FRENCH_SPEAKING = new Set(["FR", "BE", "CH", "LU", "MC", "AD"]);

/** `languageCode` of a request follows the area's country. */
export function languageFor(countryCode: string): "fr" | "en" {
  return FRENCH_SPEAKING.has((countryCode ?? "").toUpperCase()) ? "fr" : "en";
}

/** `regionCode` — the area's country, lower-case (two letters, else omitted). */
export function regionFor(countryCode: string): string | undefined {
  const cc = (countryCode ?? "").toLowerCase();
  return /^[a-z]{2}$/.test(cc) ? cc : undefined;
}

// ---- request bodies ------------------------------------------------------------------------

export type LatLng = { latitude: number; longitude: number };
export type Rect = [south: number, west: number, north: number, east: number];
export const MAX_RADIUS_M = 50_000;
export const SEARCH_PAGE_SIZE = 20;
export const MATCH_PAGE_SIZE = 5;
export const MATCH_BIAS_RADIUS_M = 2_000;

function clampRadius(m: number): number {
  return Math.max(1, Math.min(MAX_RADIUS_M, Math.round(m)));
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function point(lat: number, lng: number): LatLng {
  return { latitude: round6(lat), longitude: round6(lng) };
}

export type TextSearchInput = {
  textQuery: string;
  includedType?: string | null;
  /** locationRestriction rectangle — exclusive with `bias`. */
  rect?: Rect;
  /** locationBias circle — exclusive with `rect`; radius clamped to 50 km. */
  bias?: { lat: number; lng: number; radiusM: number };
  languageCode: "fr" | "en";
  regionCode?: string;
  pageToken?: string | null;
};

export type TextSearchBody = {
  textQuery: string;
  includedType?: string;
  strictTypeFiltering: boolean;
  languageCode: string;
  regionCode?: string;
  pageSize: number;
  locationRestriction?: { rectangle: { low: LatLng; high: LatLng } };
  locationBias?: { circle: { center: LatLng; radius: number } };
  pageToken?: string;
};

/** `POST /v1/places:searchText` body. */
export function textSearchBody(input: TextSearchInput): TextSearchBody {
  if (input.rect && input.bias) throw new Error("textSearchBody: rect and bias are exclusive");
  const body: TextSearchBody = {
    textQuery: input.textQuery.trim().slice(0, 200),
    strictTypeFiltering: !!input.includedType,
    languageCode: input.languageCode,
    pageSize: SEARCH_PAGE_SIZE,
  };
  if (input.includedType) body.includedType = input.includedType;
  if (input.regionCode) body.regionCode = input.regionCode;
  if (input.rect) {
    const [s, w, n, e] = input.rect;
    body.locationRestriction = { rectangle: { low: point(s, w), high: point(n, e) } };
  } else if (input.bias) {
    body.locationBias = { circle: { center: point(input.bias.lat, input.bias.lng), radius: clampRadius(input.bias.radiusM) } };
  }
  if (input.pageToken) body.pageToken = input.pageToken;
  return body;
}

export type NearbySearchBody = {
  includedTypes: string[];
  maxResultCount: number;
  languageCode?: string;
  regionCode?: string;
  locationRestriction: { circle: { center: LatLng; radius: number } };
};

/** `POST /v1/places:searchNearby` body — one circle, Table A types only, no text. */
export function nearbySearchBody(input: { includedTypes: string[]; center: { lat: number; lng: number }; radiusM: number; languageCode?: "fr" | "en"; regionCode?: string }): NearbySearchBody {
  const body: NearbySearchBody = {
    includedTypes: input.includedTypes.slice(0, 5),
    maxResultCount: SEARCH_PAGE_SIZE,
    locationRestriction: { circle: { center: point(input.center.lat, input.center.lng), radius: clampRadius(input.radiusM) } },
  };
  if (input.languageCode) body.languageCode = input.languageCode;
  if (input.regionCode) body.regionCode = input.regionCode;
  return body;
}

export type MatchSearchBody = {
  textQuery: string;
  languageCode: string;
  regionCode?: string;
  pageSize: number;
  locationBias?: { circle: { center: LatLng; radius: number } };
};

/** The save-time / manual-match Text Search: "<name> <city>", biased 2 km around the prospect when it has coordinates. */
export function matchSearchBody(input: { name: string; city?: string | null; lat?: number | null; lng?: number | null; countryCode: string }): MatchSearchBody {
  const textQuery = [input.name, input.city ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
  const body: MatchSearchBody = { textQuery, languageCode: languageFor(input.countryCode), pageSize: MATCH_PAGE_SIZE };
  const region = regionFor(input.countryCode);
  if (region) body.regionCode = region;
  if (typeof input.lat === "number" && typeof input.lng === "number" && Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    body.locationBias = { circle: { center: point(input.lat, input.lng), radius: MATCH_BIAS_RADIUS_M } };
  }
  return body;
}

// ---- answers ---------------------------------------------------------------------------------

export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,72}$/;

/** Real ids are ~27 chars; 72 keeps `google:<id>` inside the dismiss route's 80-char key cap. */
export function placeIdOk(id: unknown): id is string {
  return typeof id === "string" && PLACE_ID_RE.test(id);
}

/** Our shape of one search hit. `name` / `addressLine` exist for the matching step and the transient candidates only. */
export type GooglePlace = {
  placeId: string;
  name: string;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  postcode: string | null;
  country: string | null;
  adminLevel1: string | null;
  adminLevel2: string | null;
  locality: string | null;
  postalTown: string | null;
  operational: boolean | null;
  serviceArea: boolean;
  attributions: string[];
};

type Json = Record<string, unknown>;

const MAX_ATTRIBUTIONS = 5;
const MAX_ATTRIBUTION_CHARS = 80;
const MAX_TEXT = 200;

function rec(x: unknown): Json | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : null;
}

function text(x: unknown, max = MAX_TEXT): string {
  return typeof x === "string" ? x.replace(/[ -]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Provider names of `attributions[]` (ToS 3.2.4) — at most five, ≤ 80 chars each, nothing else kept. */
export function attributionNames(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const a of x) {
    const provider = text(rec(a)?.provider, MAX_ATTRIBUTION_CHARS);
    if (provider && !out.includes(provider)) out.push(provider);
    if (out.length >= MAX_ATTRIBUTIONS) break;
  }
  return out;
}

type Components = { postcode: string | null; country: string | null; adminLevel1: string | null; adminLevel2: string | null; locality: string | null; postalTown: string | null; sublocality: string | null };

function componentsOf(x: unknown): Components {
  const out: Components = { postcode: null, country: null, adminLevel1: null, adminLevel2: null, locality: null, postalTown: null, sublocality: null };
  if (!Array.isArray(x)) return out;
  for (const c of x) {
    const r = rec(c);
    if (!r) continue;
    const types = Array.isArray(r.types) ? r.types.filter((t): t is string => typeof t === "string") : [];
    const long = text(r.longText, 120);
    const short = text(r.shortText, 120);
    if (types.includes("postal_code") && !out.postcode) out.postcode = short || long;
    else if (types.includes("country") && !out.country) out.country = (short || long).toUpperCase().slice(0, 2);
    else if (types.includes("administrative_area_level_1") && !out.adminLevel1) out.adminLevel1 = long || short;
    else if (types.includes("administrative_area_level_2") && !out.adminLevel2) out.adminLevel2 = long || short;
    else if (types.includes("locality") && !out.locality) out.locality = long || short;
    else if (types.includes("postal_town") && !out.postalTown) out.postalTown = long || short;
    else if (types.includes("sublocality") && !out.sublocality) out.sublocality = long || short;
  }
  return out;
}

function operationalOf(status: unknown): boolean | null {
  if (typeof status !== "string" || !status || status === "BUSINESS_STATUS_UNSPECIFIED") return null;
  return status === "OPERATIONAL";
}

function placeOf(x: unknown): GooglePlace | null {
  const r = rec(x);
  if (!r || !placeIdOk(r.id)) return null;
  const loc = rec(r.location);
  const c = componentsOf(r.addressComponents);
  return {
    placeId: r.id,
    name: text(rec(r.displayName)?.text),
    addressLine: text(r.formattedAddress),
    lat: numOrNull(loc?.latitude),
    lng: numOrNull(loc?.longitude),
    postcode: c.postcode,
    country: c.country,
    adminLevel1: c.adminLevel1,
    adminLevel2: c.adminLevel2,
    locality: c.locality ?? c.sublocality,
    postalTown: c.postalTown,
    operational: operationalOf(r.businessStatus),
    serviceArea: r.pureServiceAreaBusiness === true,
    attributions: attributionNames(r.attributions),
  };
}

/** A Text / Nearby Search answer → our places (unknown fields dropped) and the next page token. */
export function parseSearch(json: unknown): { places: GooglePlace[]; nextPageToken: string | null } {
  const r = rec(json);
  const places: GooglePlace[] = [];
  for (const p of Array.isArray(r?.places) ? r!.places : []) {
    const place = placeOf(p);
    if (place) places.push(place);
  }
  const token = text(r?.nextPageToken, 400);
  return { places, nextPageToken: token || null };
}

/**
 * The derived listing signals of a Place Details (Enterprise) answer — booleans,
 * counts, the time and the provider names; never a string from the listing.
 */
export function signalsOf(json: unknown, now: Date = new Date()): GoogleSignals {
  const r = rec(json) ?? {};
  const hours = rec(r.regularOpeningHours);
  const periods = Array.isArray(hours?.periods) ? hours!.periods : [];
  const reviews = numOrNull(r.userRatingCount);
  return {
    operational: operationalOf(r.businessStatus),
    websiteOnListing: typeof r.websiteUri === "string" && r.websiteUri.trim().length > 0,
    hours: periods.length > 0,
    reviews: reviews === null ? 0 : Math.max(0, Math.round(reviews)),
    photos: Array.isArray(r.photos) ? r.photos.length : 0,
    fetchedAt: now.toISOString(),
    attributions: attributionNames(r.attributions),
  };
}

export const parseDetailsEnterprise = signalsOf;

export type EssentialsPlace = {
  placeId: string;
  lat: number;
  lng: number;
  countryCode: string;
  adminLevel1: string | null;
  adminLevel2: string | null;
  locality: string | null;
  postalCode: string | null;
  kindHint: AreaKind | null;
  /** What Nominatim is asked for: "<the component of the primary type>, <country>" (fallback: the formatted address). */
  query: string;
};

const KIND_BY_TYPE: [string, AreaKind][] = [
  ["country", "country"],
  ["administrative_area_level_1", "region"],
  ["administrative_area_level_2", "department"],
  ["locality", "town"],
  ["postal_town", "town"],
  ["sublocality", "town"],
  ["postal_code", "postcode"],
];

/** A Place Details (Essentials) answer for an area suggestion → coordinates, address components, a kind hint and the geocoder query. Null when unusable. */
export function parseDetailsEssentials(json: unknown): EssentialsPlace | null {
  const r = rec(json);
  if (!r || !placeIdOk(r.id)) return null;
  const loc = rec(r.location);
  const lat = numOrNull(loc?.latitude);
  const lng = numOrNull(loc?.longitude);
  if (lat === null || lng === null) return null;
  const types = Array.isArray(r.types) ? r.types.filter((t): t is string => typeof t === "string") : [];
  const c = componentsOf(r.addressComponents);
  const countryLong = (() => {
    if (!Array.isArray(r.addressComponents)) return "";
    for (const comp of r.addressComponents) {
      const cr = rec(comp);
      const t = Array.isArray(cr?.types) ? cr!.types : [];
      if (t.includes("country")) return text(cr?.longText, 80);
    }
    return "";
  })();
  let kindHint: AreaKind | null = null;
  let primary = "";
  for (const [type, kind] of KIND_BY_TYPE) {
    if (types.includes(type)) {
      kindHint = kind;
      primary = type;
      break;
    }
  }
  if (kindHint === null && types.length > 0) kindHint = "place";
  const named: Record<string, string | null> = {
    country: countryLong || c.country,
    administrative_area_level_1: c.adminLevel1,
    administrative_area_level_2: c.adminLevel2,
    locality: c.locality,
    postal_town: c.postalTown,
    sublocality: c.sublocality,
    postal_code: c.postcode,
  };
  const main = primary ? named[primary] : null;
  const query = primary === "country" ? countryLong || text(r.formattedAddress) : main ? (countryLong ? `${main}, ${countryLong}` : main) : text(r.formattedAddress);
  return {
    placeId: r.id,
    lat,
    lng,
    countryCode: c.country ?? "",
    adminLevel1: c.adminLevel1,
    adminLevel2: c.adminLevel2,
    locality: c.locality,
    postalCode: c.postcode,
    kindHint,
    query: query.slice(0, 120),
  };
}

/** Manual-match candidates from a Text Search (transient; ≤ 5; first line of the address; distance when both sides have coordinates). */
export function candidatesOf(places: readonly GooglePlace[], prospect: { lat?: number | null; lng?: number | null }): GoogleCandidate[] {
  const hasPoint = typeof prospect.lat === "number" && typeof prospect.lng === "number" && Number.isFinite(prospect.lat) && Number.isFinite(prospect.lng);
  return places.slice(0, MATCH_PAGE_SIZE).map((p) => ({
    placeId: p.placeId,
    name: p.name.slice(0, MAX_TEXT),
    addressLine: p.addressLine.split(",")[0]!.trim().slice(0, MAX_TEXT),
    distanceM: hasPoint && p.lat !== null && p.lng !== null ? Math.round(haversineM({ lat: prospect.lat!, lng: prospect.lng! }, { lat: p.lat, lng: p.lng })) : null,
    attributions: p.attributions,
  }));
}

export type GoogleErrorCode = "off" | "no_key" | "mask_tier" | "allowance" | "refused" | "bad_request" | "busy" | "timeout" | "network" | "unavailable" | "aborted";

/** An HTTP failure → our error code (the body is read for the status word only, never kept). */
export function parseError(status: number, json?: unknown): GoogleErrorCode {
  const word = text(rec(rec(json)?.error)?.status, 40);
  if (status === 403 || word === "PERMISSION_DENIED") return "refused";
  if (status === 429 || word === "RESOURCE_EXHAUSTED") return "busy";
  if (status === 400 || status === 404 || word === "INVALID_ARGUMENT" || word === "NOT_FOUND") return "bad_request";
  if (status === 0) return "network";
  return "unavailable";
}
