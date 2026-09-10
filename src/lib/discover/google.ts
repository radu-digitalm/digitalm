// Google Places adapter — a stub while GOOGLE_PLACES=off (contract §6, §11).
// The DiscoveryAdapter itself lives in crm/types.ts (published day 0) and
// resolves [] without any HTTP; this file adds the on/off helpers the routes
// and the GoogleBlock use, and the monthly hard stop for the day the real
// adapter lands. Nothing here ever stores more than a place_id.
import { apiUsageMonth } from "@/lib/crm/apiUsage";
import { googleAdapter } from "@/lib/crm/types";

export { googleAdapter };

export const GOOGLE_OFF_ERROR = "google_off";

export function googlePlacesOn(): boolean {
  return googleAdapter.enabled();
}

/** GOOGLE_PLACES_MONTHLY_CAP (default 900) — Places calls per calendar month. */
export function googleMonthlyCap(): number {
  const n = Number.parseInt(process.env.GOOGLE_PLACES_MONTHLY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 900;
}

/** Calls made this month vs the cap (Today shows "Google calls this month vs 900"). */
export function googleUsage(): { used: number; cap: number; remaining: number } {
  const used = apiUsageMonth("google_places");
  const cap = googleMonthlyCap();
  return { used, cap, remaining: Math.max(0, cap - used) };
}
