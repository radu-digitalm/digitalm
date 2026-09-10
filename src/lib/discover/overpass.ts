// OpenStreetMap discovery through the Overpass API (contract §6 "osm").
// One POST per tile (≤ 0.25° a side) and category, sequential, ≥ 1 s apart,
// one retry after 10 s on 429/504, cached 24 h per tile + category. Every
// foreign value goes through coerceHttpUrl / validEmail before it leaves this
// file; only the fields Business needs are kept (and cached).
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { coerceHttpUrl, validEmail } from "@/lib/crm/classify";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { Area, Business, Category } from "@/lib/crm/types";
import { tilesFor, type Bbox } from "./geocode";
import { buildQuery } from "./overpassQuery";
import type { AdapterResult, RichAdapter } from "./index";

export { buildQuery } from "./overpassQuery";

const OVERPASS_GAP_MS = 1000;
const RETRY_AFTER_MS = 10_000;
const TILE_RESERVE_MS = 3_000; // leave this much budget before starting another tile

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function firstOf(v: string | undefined): string | undefined {
  return v ? v.split(";")[0]?.trim() || undefined : undefined;
}

function cleanPhone(v: string | undefined): string | undefined {
  const p = firstOf(v)?.replace(/[^\d+().\-\s/]/g, "").trim();
  return p && p.replace(/\D/g, "").length >= 6 ? p.slice(0, 40) : undefined;
}

function cleanText(v: string | undefined, max = 120): string | undefined {
  const t = v?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

/** One OSM element → Business, or null when it has no name. */
export function mapElement(el: OverpassElement, area: Area, category: Category): Business | null {
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
  const matched = category.osm.find((t) => tags[t.k] === t.v);
  const addressLine = cleanText([tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "));
  return {
    source: "osm",
    sourceId: `${el.type}/${el.id}`,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name,
    addressLine,
    postcode: cleanText(tags["addr:postcode"], 12),
    city: cleanText(tags["addr:city"], 80),
    countryCode: /^[A-Z]{2}$/.test(addrCountry) ? addrCountry : area.countryCode,
    lat: hasGeo ? lat : undefined,
    lng: hasGeo ? lng : undefined,
    geoSource: hasGeo ? "source" : "none",
    website,
    phone: cleanPhone(tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"]),
    email,
    brand: cleanText(tags.brand, 60),
    tags: matched ? { [matched.k]: matched.v } : undefined,
  };
}

async function fetchTile(category: Category, tile: Bbox, signal: AbortSignal, deadline: number): Promise<{ elements: OverpassElement[]; hit: boolean }> {
  const query = buildQuery(category, tile);
  const request = { tile: tile.map((n) => n.toFixed(4)), osm: category.osm };
  const post = () =>
    fetchJson<{ elements?: OverpassElement[] }>(HOSTS.overpass, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      timeoutMs: 30_000,
      signal,
    });
  const { value, hit } = await cached<{ elements: OverpassElement[] }>("overpass", request, DAY_MS, async () => {
    let res: { data: { elements?: OverpassElement[] } };
    try {
      res = await spaced("overpass", OVERPASS_GAP_MS, post);
    } catch (e) {
      const retryable = e instanceof HttpError && (e.status === 429 || e.status === 504);
      if (!retryable || Date.now() + RETRY_AFTER_MS + TILE_RESERVE_MS > deadline || signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
      res = await spaced("overpass", OVERPASS_GAP_MS, post);
    }
    // Slim the elements before caching: coordinates + tags only.
    const elements = (res.data.elements ?? []).map((el) => ({ type: el.type, id: el.id, lat: el.lat, lon: el.lon, center: el.center, tags: el.tags }));
    return { elements };
  });
  if (!hit) countApiUsage("overpass");
  return { elements: value.elements, hit };
}

/** Tile-by-tile search; stops early (partial) when the budget runs out. */
export async function searchOsm(area: Area, category: Category, opts: { budgetMs: number; signal: AbortSignal }): Promise<AdapterResult> {
  const deadline = Date.now() + opts.budgetMs;
  const tiles = tilesFor(area.bbox);
  const rows: Business[] = [];
  const notes: string[] = [];
  let partial = false;
  if (category.osm.length === 0) return { rows, partial, notes: ["OSM: no tag for this trade"] };
  for (let i = 0; i < tiles.length; i++) {
    if (opts.signal.aborted || Date.now() + TILE_RESERVE_MS > deadline) {
      partial = true;
      notes.push(`OSM: stopped after ${i} of ${tiles.length} tiles (time budget)`);
      break;
    }
    try {
      const { elements } = await fetchTile(category, tiles[i]!, opts.signal, deadline);
      for (const el of elements) {
        const b = mapElement(el, area, category);
        if (b) rows.push(b);
      }
    } catch (e) {
      partial = true;
      const code = e instanceof HttpError ? e.code : "error";
      notes.push(`OSM: tile ${i + 1} of ${tiles.length} failed (${code})`);
      if (code === "timeout" || code === "aborted") break;
    }
  }
  return { rows, partial, notes };
}

export const osmAdapter: RichAdapter = {
  id: "osm",
  enabled: () => true,
  supports: () => true,
  searchRich: searchOsm,
  async search(area, category, opts) {
    return (await searchOsm(area, category, opts)).rows;
  },
};
