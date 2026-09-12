// The Google Places client (docs/finder-google-spec.md §4.1–4.2): the on/off
// switches, the three monthly pools counted on the Pacific civil day, the
// reservation-before-socket rule, the one place the server key is read, and
// the error codes the phases and routes act on. Thin by design — the request
// bodies, masks and parsers are pure (googleRequests.ts) and the live
// checklist (§8.3) covers this file. Nothing here is cached (`apiCache` is
// never imported), nothing from a response body or the key is ever logged,
// and the key travels in a header, never in a URL.
import { apiUsage, apiUsageMonth, countApiUsage, todayUtc } from "@/lib/crm/apiUsage";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import { intEnv, zonedDateString } from "@/lib/crm/time";
import { googleAdapter, type GoogleUsage } from "@/lib/crm/types";
import { isKnownMask, parseError, withinCap, type GoogleErrorCode } from "./googleRequests";

export { googleAdapter };
export type { GoogleErrorCode };

export const GOOGLE_OFF_ERROR = "google_off";
/** Discovery stops this many searches short of the search cap so listing checks and manual matches keep theirs (§4.3). */
export const GOOGLE_SEARCH_RESERVE = 500;
const GAP_MS = 100;
const TIMEOUT_MS = 15_000;
const RETRY_MAX_MS = 30_000;
const RETRY_DEFAULT_MS = 2_000;

export type GoogleKind = "search" | "details_enterprise" | "details_essentials";
export type GooglePool = "google_search" | "google_details_enterprise" | "google_details_other";

export const POOL_OF: Record<GoogleKind, GooglePool> = {
  search: "google_search",
  details_enterprise: "google_details_enterprise",
  details_essentials: "google_details_other",
};

export class GoogleError extends Error {
  code: GoogleErrorCode;
  pool?: GooglePool;
  status?: number;
  constructor(code: GoogleErrorCode, pool?: GooglePool, status?: number) {
    super(code);
    this.name = "GoogleError";
    this.code = code;
    if (pool) this.pool = pool;
    if (status !== undefined) this.status = status;
  }
}

// ---- switches ----------------------------------------------------------------------

/** GOOGLE_PLACES=on and a server key: the map, the suggestions and the listing check exist. */
export function googlePlacesOn(): boolean {
  return googleAdapter.enabled();
}

/** The switch is on but no key was given (note #18 on the find page, the Today card). */
export function googleKeyMissing(): boolean {
  return process.env.GOOGLE_PLACES === "on" && !process.env.GOOGLE_PLACES_KEY;
}

/** D1: searches also ask Google. */
export function googleDiscoveryOn(): boolean {
  return googlePlacesOn() && process.env.GOOGLE_PLACES_DISCOVERY === "on";
}

/** D4: the finder map is Google Maps when the browser key and the Map ID exist (read server-side, passed to pages as props). */
export function googleMapConfigured(): boolean {
  return googlePlacesOn() && !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY && !!process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
}

// ---- pools and caps ------------------------------------------------------------------

/** Google's free tier resets on the 1st at midnight Pacific: the pools are counted on that civil day. */
export function googleDay(at = new Date()): string {
  return zonedDateString("America/Los_Angeles", at);
}

export function googleMonthKey(at = new Date()): string {
  return googleDay(at).slice(0, 7);
}

/** GOOGLE_PLACES_MONTHLY_CAP (default 900) — Place Details Enterprise, the listing checks. */
export function googleMonthlyCap(): number {
  return intEnv("GOOGLE_PLACES_MONTHLY_CAP", 900);
}

export function googleCaps(): Record<GooglePool, number> {
  return {
    google_details_enterprise: googleMonthlyCap(),
    google_search: intEnv("GOOGLE_SEARCH_MONTHLY_CAP", 4_500),
    google_details_other: intEnv("GOOGLE_DETAILS_MONTHLY_CAP", 4_500),
  };
}

/** GOOGLE_SEARCH_MAX_REQUESTS (default 30) — requests one search may spend on discovery. */
export function googleSearchMaxRequests(): number {
  return Math.max(1, intEnv("GOOGLE_SEARCH_MAX_REQUESTS", 30));
}

/** GOOGLE_CHECK_DAILY_CAP (default 30) — Google-only audits (prospects without a website) per UTC day. */
export function googleCheckDailyCap(): number {
  return intEnv("GOOGLE_CHECK_DAILY_CAP", 30);
}

export function googleCheckUsageToday(): { used: number; cap: number } {
  return { used: apiUsage("google_check_day", todayUtc()), cap: googleCheckDailyCap() };
}

/** The three pools this month against their caps (Today, the routes' `usage`). */
export function googleUsage(): GoogleUsage {
  const month = googleMonthKey();
  const caps = googleCaps();
  return {
    checks: { used: apiUsageMonth("google_details_enterprise", month), cap: caps.google_details_enterprise },
    searches: { used: apiUsageMonth("google_search", month), cap: caps.google_search },
    other: { used: apiUsageMonth("google_details_other", month), cap: caps.google_details_other },
  };
}

// ---- the request --------------------------------------------------------------------------

export type GoogleFetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  mask: string;
  signal?: AbortSignal;
  /** Honour one Retry-After (≤ 30 s) on 429 — the runner phase only; routes answer within their budget. */
  retry?: boolean;
  /** Keep this many requests of the pool back (discovery: GOOGLE_SEARCH_RESERVE). */
  reserve?: number;
  timeoutMs?: number;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(t);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function toGoogleError(e: unknown, pool: GooglePool): GoogleError {
  if (e instanceof GoogleError) return e;
  if (e instanceof HttpError) {
    if (e.code === "aborted") return new GoogleError("aborted", pool);
    if (e.code === "timeout") return new GoogleError("timeout", pool);
    if (e.code === "network" || e.code === "host_not_allowed") return new GoogleError("network", pool);
    if (e.code === "bad_json") return new GoogleError("unavailable", pool, e.status);
    if (e.status > 0) return new GoogleError(parseError(e.status), pool, e.status);
  }
  return new GoogleError("unavailable", pool);
}

/**
 * One Places API (New) request. Throws GoogleError: `off`, `no_key`,
 * `mask_tier` (a mask that is not one of the three constants), `allowance`
 * (the pool is at its cap — decided BEFORE any socket), `refused` (403 — key
 * restriction or API not enabled), `bad_request` (400 / 404), `busy` (429),
 * `timeout`, `network`, `unavailable` (other 5xx), `aborted`. The pool is
 * reserved before the socket; a request Google rejected without processing
 * (`refused`, `bad_request`) releases it; a timeout, a busy answer or a 5xx
 * stays counted because Google may have processed it.
 */
export async function googleFetch<T = unknown>(kind: GoogleKind, path: string, opts: GoogleFetchOptions): Promise<T> {
  const pool = POOL_OF[kind];
  if (process.env.GOOGLE_PLACES !== "on") throw new GoogleError("off", pool);
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) throw new GoogleError("no_key", pool);
  if (!isKnownMask(opts.mask)) throw new GoogleError("mask_tier", pool);
  if (!path.startsWith("/v1/")) throw new GoogleError("bad_request", pool);

  const cap = googleCaps()[pool];
  const day = googleDay();
  const used = apiUsageMonth(pool, day.slice(0, 7));
  if (!withinCap(used, cap, opts.reserve ?? 0)) throw new GoogleError("allowance", pool);
  countApiUsage(pool, 1, day);

  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const url = `${HOSTS.googlePlaces}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": opts.mask };
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  try {
    const res = await spaced("google", GAP_MS, () => fetchJson<T>(url, { method, headers, body, timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, signal: opts.signal }));
    return res.data;
  } catch (e) {
    const err = toGoogleError(e, pool);
    if (err.code === "refused" || err.code === "bad_request") {
      countApiUsage(pool, -1, day);
      if (err.code === "refused") console.error(`google: refused (${err.status ?? 403})`);
      throw err;
    }
    if (err.code === "busy" && opts.retry && !opts.signal?.aborted) {
      const wait = e instanceof HttpError && e.retryAfterMs !== undefined ? e.retryAfterMs : RETRY_DEFAULT_MS;
      if (wait <= RETRY_MAX_MS) {
        await sleep(wait, opts.signal);
        return googleFetch<T>(kind, path, { ...opts, retry: false });
      }
    }
    throw err;
  }
}
