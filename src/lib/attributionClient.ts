"use client";

import { ATTRIBUTION_KEYS, type Attribution } from "@/lib/attribution";

/** utm_* + oppref currently in the page URL — read at submit time, never stored. */
export function currentAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Attribution = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/** Same parameters as a query string to append to an internal link ("" when none). */
export function attributionQuery(): string {
  const a = currentAttribution();
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(a)) if (v) p.set(k, v);
  return p.toString();
}
