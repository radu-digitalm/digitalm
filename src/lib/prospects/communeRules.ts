// Pure rules for the exact-commune lookup on save (docs/finder-ux-spec.md
// §3.8): which rows need one, at most 100 per save, and the 4-decimal cache
// key. The network call lives in communeLookup.ts (geo.gouv, 30-day cache).
import { coordKey } from "../discover/townFill.ts";

export const MAX_LOOKUPS_PER_SAVE = 100;

export { coordKey };

export type LookupCandidate = { countryCode: string; cityApprox?: boolean; lat?: number; lng?: number; geoSource?: string };

/** French rows with source coordinates whose town is approximate — the first `max`, deduplicated by 4-dp key. */
export function selectLookups<T extends LookupCandidate>(rows: readonly T[], max = MAX_LOOKUPS_PER_SAVE): { row: T; key: string }[] {
  const out: { row: T; key: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.countryCode !== "FR" || row.cityApprox !== true || row.geoSource !== "source") continue;
    if (typeof row.lat !== "number" || typeof row.lng !== "number" || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    const key = coordKey(row.lat, row.lng);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ row, key });
    if (out.length >= max) break;
  }
  return out;
}
