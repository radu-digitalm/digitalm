// Town fill (docs/finder-ux-spec.md §3.8), pure part: the nearest commune /
// municipality centre within 6 km of a point, the 4-decimal cache key the
// exact commune lookup uses, and the department(s) a French postcode belongs
// to (for loading geo.gouv's commune centres per department).
import { haversineKm } from "./polygon.ts";

export const TOWN_FILL_KM = 6;

export type CentrePoint = { name: string; lat: number; lng: number; postcode?: string; code?: string };

/** The nearest centre within `maxKm` (ties by distance, then input order), or null. */
export function nearestCentre(points: readonly CentrePoint[], lat: number, lng: number, maxKm = TOWN_FILL_KM): (CentrePoint & { km: number }) | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: (CentrePoint & { km: number }) | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !p.name) continue;
    // Cheap pre-filter: 1° of latitude is ~111 km, so anything beyond maxKm / 100 degrees is out.
    if (Math.abs(p.lat - lat) > maxKm / 100) continue;
    const km = haversineKm({ lat, lng }, { lat: p.lat, lng: p.lng });
    if (km <= maxKm && (best === null || km < best.km)) best = { ...p, km };
  }
  return best;
}

/** "42.9646,1.6053" — coordinates rounded to 4 decimals (≈ 11 m), the commune-lookup cache key. */
export function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Department code(s) of a French postcode: "09000" → ["09"], "20000" → ["2A", "2B"], "97100" → ["971"]; [] when malformed. */
export function departementsOfPostcode(postcode: string | undefined | null): string[] {
  const pc = (postcode ?? "").replace(/\s+/g, "");
  if (!/^\d{5}$/.test(pc)) return [];
  if (pc.startsWith("97") || pc.startsWith("98")) return [pc.slice(0, 3)];
  if (pc.startsWith("20")) return ["2A", "2B"];
  return [pc.slice(0, 2)];
}
