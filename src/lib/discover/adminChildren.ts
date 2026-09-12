// Administrative children and commune centres through Overpass (docs/
// finder-ux-spec.md §2.5, §3.8): the departments of a region (or the regions
// of a country, or the communes of a department) as units, the admin_level-8
// centres used to name a town for rows without one, and the commune that
// contains a point (prospect backfill outside France). Everything is cached
// 24 h (30 d for the point lookup) and goes through the 1 req/s Overpass lane.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HttpError } from "@/lib/crm/http";
import type { AreaSelector } from "@/lib/crm/types";
import { childrenQuery, communesQuery, containingCommuneQuery, type Bbox } from "./areaQuery";
import { overpassPost, type OverpassElement } from "./overpass";
import type { ChildRel } from "./plan";
import { coordKey, type CentrePoint } from "./townFill";

const RETRY_MS = 5_000;
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

async function postOnceOrRetry<T>(query: string, signal?: AbortSignal): Promise<T> {
  try {
    return await overpassPost<T>(query, { timeoutMs: 60_000, signal });
  } catch (e) {
    const busy = e instanceof HttpError && (e.status === 429 || e.status === 504);
    if (!busy || signal?.aborted) throw e;
    await new Promise((r) => setTimeout(r, RETRY_MS));
    return overpassPost<T>(query, { timeoutMs: 60_000, signal });
  }
}

function centreOf(el: OverpassElement): { lat: number; lng: number } | null {
  const lat = el.center?.lat ?? el.lat;
  const lng = el.center?.lon ?? el.lon;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function tidy(s: string | undefined, max = 80): string | undefined {
  const t = s?.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

/** Named children with a centre at one admin level (`ref:INSEE`, else `ISO3166-2`, as the code). Cached 24 h. */
export async function fetchChildren(selector: AreaSelector, level: number, signal?: AbortSignal): Promise<ChildRel[]> {
  const query = childrenQuery(selector, level);
  const { value, hit } = await cached<{ children: ChildRel[] }>("overpass_children", { selector, level }, DAY_MS, async () => {
    const data = await postOnceOrRetry<{ elements?: OverpassElement[] }>(query, signal);
    const children: ChildRel[] = [];
    for (const el of data.elements ?? []) {
      if (el.type !== "relation") continue;
      const center = centreOf(el);
      const name = tidy(el.tags?.name);
      if (!center || !name) continue;
      const code = tidy(el.tags?.["ref:INSEE"] ?? el.tags?.["ISO3166-2"], 12);
      children.push(code ? { relId: el.id, name, code, center } : { relId: el.id, name, center });
    }
    return { children };
  });
  if (!hit) countApiUsage("overpass");
  return value.children;
}

/** admin_level-8 centres of a unit (town fill fallback). Cached 24 h. */
export async function fetchCommuneCentres(selector: AreaSelector, bbox?: Bbox, signal?: AbortSignal): Promise<CentrePoint[]> {
  const query = communesQuery(selector, bbox);
  const { value, hit } = await cached<{ points: CentrePoint[] }>("overpass_communes", { selector, bbox: bbox ? bbox.map((n) => n.toFixed(5)) : null }, DAY_MS, async () => {
    const data = await postOnceOrRetry<{ elements?: OverpassElement[] }>(query, signal);
    const points: CentrePoint[] = [];
    for (const el of data.elements ?? []) {
      const c = centreOf(el);
      const name = tidy(el.tags?.name);
      if (!c || !name) continue;
      const p: CentrePoint = { name, lat: c.lat, lng: c.lng };
      const code = tidy(el.tags?.["ref:INSEE"], 12);
      const postcode = tidy(el.tags?.["addr:postcode"] ?? el.tags?.postal_code, 12);
      if (code) p.code = code;
      if (postcode) p.postcode = postcode;
      points.push(p);
    }
    return { points };
  });
  if (!hit) countApiUsage("overpass");
  return value.points;
}

export type ContainingCommune = { name: string; code?: string; postcode?: string };

/** The admin_level-8 area containing a point (`is_in`), cached 30 d by 4-dp coordinates; null when none. */
export async function communeContaining(lat: number, lng: number, signal?: AbortSignal): Promise<ContainingCommune | null> {
  const query = containingCommuneQuery(lat, lng);
  const { value, hit } = await cached<{ commune: ContainingCommune | null }>("overpass_is_in", { at: coordKey(lat, lng) }, 30 * DAY_MS, async () => {
    const data = await postOnceOrRetry<{ elements?: OverpassElement[] }>(query, signal);
    for (const el of data.elements ?? []) {
      const name = tidy(el.tags?.name);
      if (!name) continue;
      const out: ContainingCommune = { name };
      const code = tidy(el.tags?.["ref:INSEE"], 12);
      const postcode = tidy(el.tags?.["addr:postcode"] ?? el.tags?.postal_code, 12);
      if (code) out.code = code;
      if (postcode) out.postcode = postcode;
      return { commune: out };
    }
    return { commune: null };
  });
  if (!hit) countApiUsage("overpass");
  return value.commune;
}
