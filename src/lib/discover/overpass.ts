// OpenStreetMap discovery through the Overpass API (docs/finder-ux-spec.md
// §2.5, §3.3). One POST per unit (an administrative area, an INSEE set, a
// radius, or a tile clipped by the area), ≥ 1 s apart on the shared lane,
// 20 / 40 / 80 s backoff when the service is busy, cached 24 h per unit +
// trade. Every foreign value goes through coerceHttpUrl / safeHttpUrl /
// validEmail before it leaves this file; only what Business needs is kept.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { coerceHttpUrl, safeHttpUrl, validEmail } from "@/lib/crm/classify";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { AreaSelector, Business, Category } from "@/lib/crm/types";
import { UNIT_LIMIT, countQuery, unitQuery, type Bbox } from "./areaQuery";
import type { UnitError } from "./progress";

export const OVERPASS_GAP_MS = 1000;
export const BACKOFF_MS = [20_000, 40_000, 80_000] as const;
const UNIT_TIMEOUT_MS = 60_000;
const COUNT_GRACE_MS = 5_000; // client timeout = the query's server-side timeout + this
const COUNT_RETRY_MS = 3_000;

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

/** One Overpass POST on the shared 1 req/s lane. */
export async function overpassPost<T = { elements?: OverpassElement[] }>(query: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const res = await spaced("overpass", OVERPASS_GAP_MS, () =>
    fetchJson<T>(HOSTS.overpass, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      timeoutMs: opts.timeoutMs ?? UNIT_TIMEOUT_MS,
      signal: opts.signal,
    }),
  );
  return res.data;
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
 * Run an Overpass call with the spec's backoff: on busy / timeout / network
 * wait 20 s, 40 s, 80 s (calling `onRetry` with the moment the wait ends)
 * and try again; after the third failure throw UnitFailure. Aborts stop at once.
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: { signal?: AbortSignal; onRetry?: (untilIso: string | null) => void } = {}): Promise<T> {
  let last: UnitError = "network";
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (opts.signal?.aborted) throw new HttpError("aborted");
    try {
      const out = await fn();
      opts.onRetry?.(null);
      return out;
    } catch (e) {
      if (e instanceof HttpError && e.code === "aborted") throw e;
      last = errorWord(e);
      if (attempt === BACKOFF_MS.length) break;
      const wait = BACKOFF_MS[attempt]!;
      opts.onRetry?.(new Date(Date.now() + wait).toISOString());
      await sleep(wait, opts.signal);
      if (opts.signal?.aborted) throw new HttpError("aborted");
    }
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
  try {
    const { value, hit } = await cached<{ total: number }>("overpass_count", { selector, trade: categoryKeyOf(category) }, DAY_MS, async () => {
      let data: { elements?: { tags?: Record<string, string> }[] };
      try {
        data = await post();
      } catch (e) {
        // One quick retry when the service is merely busy; a slow count is not retried (the route's budget).
        if (!(e instanceof HttpError && (e.status === 429 || e.status === 503)) || signal?.aborted) throw e;
        await sleep(COUNT_RETRY_MS, signal);
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
  opts: { signal?: AbortSignal; onRetry?: (untilIso: string | null) => void } = {},
): Promise<UnitRead> {
  const query = unitQuery(category, unit.selector, unit.bbox);
  const request = { selector: unit.selector, bbox: unit.bbox ? unit.bbox.map((n) => n.toFixed(5)) : null, trade: categoryKeyOf(category) };
  const { value, hit } = await cached<{ elements: OverpassElement[]; readAt: string }>("overpass", request, DAY_MS, async () => {
    const data = await withBackoff(() => overpassPost(query, { timeoutMs: UNIT_TIMEOUT_MS, signal: opts.signal }), opts);
    return { elements: slim(data.elements), readAt: new Date().toISOString() };
  });
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
    tags: matched ? { [matched.k]: matched.v } : undefined,
  };
  const socials = socialsOf(tags);
  if (socials) b.socials = socials;
  return b;
}
