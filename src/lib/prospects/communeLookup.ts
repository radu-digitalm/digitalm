// Exact commune for a point (docs/finder-ux-spec.md §3.8): geo.api.gouv.fr
// /communes?lat&lon, cached 30 d by 4-decimal coordinates, ≤ 5 req/s on the
// geo_gouv lane. Used on save for French rows whose town was approximate and
// by the prospect town backfill. A failure keeps the approximate town.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HOSTS, fetchJson, spaced } from "@/lib/crm/http";
import { coordKey } from "@/lib/discover/townFill";

export { MAX_LOOKUPS_PER_SAVE, selectLookups } from "./communeRules";

const GAP_MS = 200;

export type CommuneAt = { nom: string; code: string; codesPostaux: string[] };

/** The commune containing a point, or null when geo.gouv knows none (outside France). */
export async function communeAt(lat: number, lng: number, signal?: AbortSignal): Promise<CommuneAt | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const url = `${HOSTS.geoGouv}/communes?${new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), fields: "nom,code,codesPostaux" }).toString()}`;
  const { value, hit } = await cached<{ commune: CommuneAt | null }>("geo_gouv_commune", { at: coordKey(lat, lng) }, 30 * DAY_MS, async () => {
    const res = await spaced("geo_gouv", GAP_MS, () => fetchJson<{ nom?: string; code?: string; codesPostaux?: string[] }[]>(url, { timeoutMs: 12_000, signal }));
    const first = Array.isArray(res.data) ? res.data[0] : undefined;
    if (!first || typeof first.nom !== "string" || typeof first.code !== "string") return { commune: null };
    return { commune: { nom: first.nom.slice(0, 80), code: first.code, codesPostaux: (first.codesPostaux ?? []).filter((p) => /^\d{5}$/.test(p)) } };
  });
  if (!hit) countApiUsage("geo_gouv");
  return value.commune;
}
