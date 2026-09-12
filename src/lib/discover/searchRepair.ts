// api_cache side of searchRules.ts: a cached search written under older
// derivation rules is re-derived from the register pages still in the cache
// (also 24 h) and written back in place, before the page or the save route
// reads it.
import { cacheListByProvider, cacheUpdatePayload } from "@/lib/crm/apiCache";
import type { SearchResultV2 } from "@/lib/crm/types";
import { applyRules, diffusionBySiret, needsRepair, type RegisterPage } from "./searchRules";

export { RULES_VERSION } from "./searchRules";

/** SIRET → diffusion from every cached register page; null when none is cached. */
export function registerDiffusionMap(): Map<string, "full" | "partial"> | null {
  const pages = cacheListByProvider<RegisterPage>("fr_register");
  return pages.length === 0 ? null : diffusionBySiret(pages);
}

/** Repair `result` (stored under `key`) in place and persist it; true when something changed. */
export function repairSearchResult(result: SearchResultV2, key: string): boolean {
  if (!needsRepair(result)) return false;
  const { changed } = applyRules(result, registerDiffusionMap);
  if (changed) cacheUpdatePayload(key, result);
  return changed;
}
