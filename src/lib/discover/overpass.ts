// OpenStreetMap discovery through the Overpass API (docs/finder-ux-spec.md
// §2.5, §3.3). One POST per unit (an administrative area, an INSEE set, a
// radius, or a tile clipped by the area), ≥ 1 s apart on the shared lane,
// cached 24 h per unit + trade. Two servers: the main one and a fallback —
// a busy answer (429 / 503 / 504 / timeout, Retry-After honoured) marks that
// server busy and the next try goes to the other one at once; only when both
// are busy does the caller wait (15 s, then 30 s) before giving up on the
// unit. Every foreign value goes through coerceHttpUrl / safeHttpUrl /
// validEmail before it leaves this file; only what Business needs is kept.
import { DAY_MS, cacheKey, cacheSet, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { coerceHttpUrl, safeHttpUrl, validEmail } from "@/lib/crm/classify";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { AreaSelector, Business, Category } from "@/lib/crm/types";
import { UNIT_LIMIT, countQuery, unitQuery, type Bbox } from "./areaQuery";
import type { UnitError } from "./progress";

export const OVERPASS_GAP_MS = 1000;
/** Waits between cycles when every server is busy: two cycles, then the unit fails (the UI offers "Retry the missing areas"). */
export const BACKOFF_MS = [15_000, 30_000] as const;
export const BUSY_MARK_MS = 20_000; // how long a server stays marked busy without a Retry-After
const BUSY_MARK_MAX_MS = 120_000;
const UNIT_TIMEOUT_MS = 60_000;
const COUNT_GRACE_MS = 5_000; // client timeout = the query's server-side timeout + this
const COUNT_RETRY_MS = 3_000;
const COUNT_UNKNOWN_MS = 10 * 60_000; // a count the service could not give is remembered as unknown for this long

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** A unit that could not be read after three tries; `error` is a word, never an HTTP code. */
export class UnitFailure extends Error {
  error: UnitError;
  constructor(error: UnitError) {
    super(error);
    this.name = "UnitFailure";
    this.error = error;
  }
}

/** busy (429 / 5xx), timeout, or network — the only words the progress ever shows. */
export function errorWord(e: unknown): UnitError {
  if (e instanceof HttpError) {
    if (e.code === "timeout") return "timeout";
    if (e.status === 429 || e.status >= 500) return "busy";
  }
  return "network";
}

/**
 * Overpass reports a server-side timeout or an overloaded server as HTTP 200
 * with a `remark` and no elements — never a result. Turned into the same
 * errors as the HTTP ones so the backoff and the notes treat them alike.
 */
export function assertNoRemark(data: unknown): void {
  const remark = (data as { remark?: unknown } | null)?.remark;
  if (typeof remark !== "string") return;
  if (/timed out|timeout/i.test(remark)) throw new HttpError("timeout", 0, "overpass timed out");
  if (/runtime error|out of memory|too busy|load too high|rate_limited/i.test(remark)) throw new HttpError("http_503", 503, "overpass busy");
}

// ---- the server pool ------------------------------------------------------------------

type Endpoint = { url: string; busyUntil: number };

function pool(): Endpoint[] {
  const g = globalThis as { __dmOverpassPool?: Endpoint[] };
  if (!g.__dmOverpassPool) {
    const urls = [HOSTS.overpass, HOSTS.overpassFallback].filter((u, i, all) => u !== "" && all.indexOf(u) === i);
    g.__dmOverpassPool = urls.map((url) => ({ url, busyUntil: 0 }));
  }
  return g.__dmOverpassPool;
}

/** The server to use now: the first one not marked busy, else the one whose mark ends soonest. */
export function pickEndpoint(now = Date.now()): Endpoint {
  const all = pool();
  return all.find((e) => e.busyUntil <= now) ?? all.reduce((a, b) => (a.busyUntil <= b.busyUntil ? a : b));
}

/** True when some server is free right now (a retry need not wait). */
export function anyEndpointFree(now = Date.now()): boolean {
  return pool().some((e) => e.busyUntil <= now);
}

/** Milliseconds until the earliest busy mark ends (0 when a server is free). */
export function poolWaitMs(now = Date.now()): number {
  return Math.max(0, Math.min(...pool().map((e) => e.busyUntil - now)));
}

function markBusy(e: Endpoint, err: unknown, now = Date.now()): void {
  const hinted = err instanceof HttpError ? err.retryAfterMs : undefined;
  const ms = Math.min(BUSY_MARK_MAX_MS, Math.max(BUSY_MARK_MS, hinted ?? 0));
  e.busyUntil = Math.max(e.busyUntil, now + ms);
}

/** Busy (429 / 5xx / an Overpass "too busy" remark), timeout or network: the server is marked busy; anything else is not its fault. */
function isServerTrouble(e: unknown): boolean {
  return e instanceof HttpError && (e.code === "timeout" || e.code === "network" || e.status === 429 || e.status >= 500);
}

/** One Overpass POST on the shared 1 req/s lane, to whichever server is not busy. */
export async function overpassPost<T = { elements?: OverpassElement[] }>(query: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const endpoint = pickEndpoint();
  try {
    const res = await spaced("overpass", OVERPASS_GAP_MS, () =>
      fetchJson<T>(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: opts.timeoutMs ?? UNIT_TIMEOUT_MS,
        signal: opts.signal,
      }),
    );
    assertNoRemark(res.data);
    return res.data;
  } catch (e) {
    if (isServerTrouble(e) && !opts.signal?.aborted) markBusy(endpoint, e);
    throw e;
  }
}

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

/**
 * Run an Overpass call with the pool's backoff: on busy / timeout / network
 * the failing server is marked busy (see overpassPost); when another server
 * is free the call is repeated at once on it, otherwise the caller waits
 * 15 s, then 30 s (`onRetry` gets the moment the wait ends — the UI shows
 * "retrying in 19 s") — at most two waits, then UnitFailure. Aborts stop at once.
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: { signal?: AbortSignal; onRetry?: (untilIso: string | null) => void } = {}): Promise<T> {
  let last: UnitError = "network";
  const attempt = async (): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (opts.signal?.aborted) throw new HttpError("aborted");
    try {
      const value = await fn();
      opts.onRetry?.(null);
      return { ok: true, value };
    } catch (e) {
      if (e instanceof HttpError && e.code === "aborted") throw e;
      last = errorWord(e);
      return { ok: false };
    }
  };
  for (let cycle = 0; cycle <= BACKOFF_MS.length; cycle++) {
    const first = await attempt();
    if (first.ok) return first.value;
    // Another server is free: try it now rather than waiting.
    if (anyEndpointFree()) {
      const second = await attempt();
      if (second.ok) return second.value;
    }
    if (cycle === BACKOFF_MS.length) break;
    const wait = Math.max(BACKOFF_MS[cycle]!, Math.min(BUSY_MARK_MAX_MS, poolWaitMs()));
    opts.onRetry?.(new Date(Date.now() + wait).toISOString());
    await sleep(wait, opts.signal);
    if (opts.signal?.aborted) throw new HttpError("aborted");
  }
  opts.onRetry?.(null);
  throw new UnitFailure(last);
}

function slim(elements: OverpassElement[] | undefined): OverpassElement[] {
  return (elements ?? []).map((el) => ({ type: el.type, id: el.id, lat: el.lat, lon: el.lon, center: el.center, tags: el.tags }));
}

function categoryKeyOf(category: Category): string {
  return category.osm.map((t) => `${t.k}=${t.v}`).join("|");
}

/**
 * The estimate (§2.5): one `out count` on the whole area, cached 24 h by
 * (selector, trade). Null when the service is busy or slow — the search still
 * runs, the progress just shows "found so far".
 */
export async function overpassCount(selector: AreaSelector, category: Category, opts: { signal?: AbortSignal; timeoutS?: number } = {}): Promise<{ expected: number | null; ms: number }> {
  const started = Date.now();
  const timeoutS = opts.timeoutS ?? 30;
  const query = countQuery(category, selector, timeoutS);
  const signal = opts.signal;
  const post = () => overpassPost<{ elements?: { tags?: Record<string, string> }[] }>(query, { timeoutMs: timeoutS * 1000 + COUNT_GRACE_MS, signal });
  const request = { selector, trade: categoryKeyOf(category) };
  try {
    const { value, hit } = await cached<{ total: number | null }>("overpass_count", request, DAY_MS, async () => {
      let data: { elements?: { tags?: Record<string, string> }[] };
      try {
        data = await post();
      } catch (e) {
        // One quick retry when the service is merely busy — on the other server when one is free; a slow count is not retried (the route's budget).
        if (!(e instanceof HttpError && (e.status === 429 || e.status === 503)) || signal?.aborted) throw e;
        if (!anyEndpointFree()) await sleep(COUNT_RETRY_MS, signal);
        data = await post();
      }
      const total = Number(data.elements?.[0]?.tags?.total ?? Number.NaN);
      if (!Number.isFinite(total)) throw new HttpError("bad_json");
      return { total };
    });
    if (!hit) countApiUsage("overpass");
    return { expected: value.total, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof HttpError && e.code === "aborted") throw e;
    // Remember the miss briefly so the confirm-cap re-post (and a retry a minute later) does not wait another 30 s.
    cacheSet(cacheKey("overpass_count", request), "overpass_count", { total: null }, COUNT_UNKNOWN_MS);
    return { expected: null, ms: Date.now() - started };
  }
}

export type UnitRead = { elements: OverpassElement[]; readAt: string; truncated: boolean; hit: boolean };

/**
 * One unit's elements (centres + tags), cached 24 h by (selector, tile box,
 * trade) so a continued or repeated search costs nothing for finished units.
 * Throws UnitFailure after three tries, HttpError("aborted") on cancel.
 */
export async function fetchUnit(
  unit: { selector: AreaSelector; bbox?: Bbox },
  category: Category,
  opts: { signal?: AbortSignal; onRetry?: (untilIso: string | null) => void; fresh?: boolean } = {},
): Promise<UnitRead> {
  const query = unitQuery(category, unit.selector, unit.bbox);
  const request = { selector: unit.selector, bbox: unit.bbox ? unit.bbox.map((n) => n.toFixed(5)) : null, trade: categoryKeyOf(category) };
  const { value, hit } = await cached<{ elements: OverpassElement[]; readAt: string }>(
    "overpass",
    request,
    DAY_MS,
    async () => {
      const data = await withBackoff(() => overpassPost(query, { timeoutMs: UNIT_TIMEOUT_MS, signal: opts.signal }), opts);
      return { elements: slim(data.elements), readAt: new Date().toISOString() };
    },
    { fresh: opts.fresh === true },
  );
  if (!hit) countApiUsage("overpass");
  return { elements: value.elements, readAt: value.readAt, truncated: value.elements.length >= UNIT_LIMIT, hit };
}

// ---- element mapping ------------------------------------------------------------------

function firstOf(v: string | undefined): string | undefined {
  return v ? v.split(";")[0]?.trim() || undefined : undefined;
}

function cleanPhone(v: string | undefined): string | undefined {
  const p = firstOf(v)?.replace(/[^\d+().\-\s/]/g, "").trim();
  return p && p.replace(/\D/g, "").length >= 6 ? p.slice(0, 40) : undefined;
}

// Control characters (U+0000–U+001F, U+007F) become spaces; runs of whitespace collapse.
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

function cleanText(v: string | undefined, max = 120): string | undefined {
  const t = v?.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

const SOCIAL_KEYS = ["facebook", "instagram", "linkedin", "twitter"] as const;

/** contact:facebook|instagram|linkedin|twitter → validated https URLs (a bare handle becomes the site URL). */
export function socialsOf(tags: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const bases: Record<(typeof SOCIAL_KEYS)[number], string> = {
    facebook: "https://www.facebook.com/",
    instagram: "https://www.instagram.com/",
    linkedin: "https://www.linkedin.com/company/",
    twitter: "https://x.com/",
  };
  for (const k of SOCIAL_KEYS) {
    const raw = firstOf(tags[`contact:${k}`] ?? tags[k]);
    if (!raw) continue;
    const handle = raw.replace(/^@/, "");
    const url = safeHttpUrl(raw) ?? (/^[A-Za-z0-9_.-]{2,60}$/.test(handle) ? `${bases[k]}${handle}` : null);
    if (url) out[k] = url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type OsmBusiness = Business & { socials?: Record<string, string>; countrySource: "source" | "area" };

/** One OSM element → Business (+ socials, country provenance), or null when it has no name. */
export function mapElement(el: OverpassElement, area: { countryCode: string }, category: Category): OsmBusiness | null {
  const tags = el.tags ?? {};
  const name = cleanText(tags.name ?? tags["name:fr"] ?? tags["name:en"]);
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const hasGeo = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng);
  const website = coerceHttpUrl(firstOf(tags.website ?? tags["contact:website"] ?? tags.url)) ?? undefined;
  const emailRaw = firstOf(tags.email ?? tags["contact:email"])?.toLowerCase();
  const email = emailRaw && validEmail(emailRaw) ? emailRaw : undefined;
  const addrCountry = (tags["addr:country"] ?? "").toUpperCase();
  const countryFromSource = /^[A-Z]{2}$/.test(addrCountry);
  const matched = category.osm.find((t) => tags[t.k] === t.v);
  const addressLine = cleanText([tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "));
  // What the card shows about the business itself (plain text only, bounded).
  const kept: Record<string, string> = matched ? { [matched.k]: matched.v } : {};
  const cuisine = cleanText(tags.cuisine, 80);
  const hours = cleanText(tags.opening_hours, 200);
  const description = cleanText(tags.description ?? tags["description:fr"] ?? tags["description:en"], 300);
  if (cuisine) kept.cuisine = cuisine;
  if (hours) kept.opening_hours = hours;
  if (description) kept.description = description;
  const b: OsmBusiness = {
    source: "osm",
    sourceId: `${el.type}/${el.id}`,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name,
    addressLine,
    postcode: cleanText(tags["addr:postcode"], 12),
    city: cleanText(tags["addr:city"], 80),
    countryCode: countryFromSource ? addrCountry : area.countryCode,
    countrySource: countryFromSource ? "source" : "area",
    lat: hasGeo ? lat : undefined,
    lng: hasGeo ? lng : undefined,
    geoSource: hasGeo ? "source" : "none",
    website,
    phone: cleanPhone(tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"]),
    email,
    brand: cleanText(tags.brand, 60),
    tags: Object.keys(kept).length > 0 ? kept : undefined,
  };
  const socials = socialsOf(tags);
  if (socials) b.socials = socials;
  return b;
}
