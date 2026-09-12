// Which rules built a cached search's rows, and how an older result is
// brought up to date (pure — no DB; searchRepair.ts wraps it with the
// api_cache reads and the write-back). Results are cached 24 h, so a change
// in the derivation would otherwise wait a day to show.
//
// Rule 2 (QA round 2): the register's statut_diffusion is a letter ("O" /
// "P"), not the word "diffusible" — every register row had been read as
// "not listed publicly" and could not be saved.
import type { SearchResultV2 } from "../crm/types.ts";
import { SIRET_RE, diffusionOf, type SlimCompany } from "./frRegisterMap.ts";

export const RULES_VERSION = 2;

export type RegisterPage = { results?: SlimCompany[] };

/** SIRET → diffusion for every establishment in a set of register pages. */
export function diffusionBySiret(pages: readonly RegisterPage[]): Map<string, "full" | "partial"> {
  const map = new Map<string, "full" | "partial">();
  for (const page of pages) {
    for (const c of page.results ?? []) {
      const etabs = [...(c.matching_etablissements ?? []), ...(c.siege ? [c.siege] : [])];
      for (const e of etabs) if (e.siret && SIRET_RE.test(e.siret)) map.set(e.siret, diffusionOf(c.statut_diffusion, e.statut_diffusion_etablissement));
    }
  }
  return map;
}

export function needsRepair(result: Pick<SearchResultV2, "version" | "rulesVersion">): boolean {
  return result.version === 2 && (result.rulesVersion ?? 1) < RULES_VERSION;
}

/**
 * Bring a result up to the current rules, in place. `lookup` gives the
 * SIRET → diffusion map from the cached register pages, or null when no page
 * is cached. The result is marked current once every register row could be
 * re-derived — or nothing more can be learnt — so the caller can write it
 * back; otherwise the next read tries again.
 */
export function applyRules(result: SearchResultV2, lookup: () => Map<string, "full" | "partial"> | null): { changed: boolean; complete: boolean } {
  if (!needsRepair(result)) return { changed: false, complete: true };
  const registerRows = result.rows.filter((r) => r.sources.includes("fr_register") && r.registerId);
  let changed = false;
  let complete = true;
  if (registerRows.length > 0) {
    const map = lookup();
    if (map) {
      for (const r of registerRows) {
        const d = map.get(r.registerId!);
        if (!d) {
          complete = false;
          continue;
        }
        if (r.diffusion !== d) {
          r.diffusion = d;
          changed = true;
        }
      }
    }
  }
  if (complete) {
    result.rulesVersion = RULES_VERSION;
    changed = true;
  }
  return { changed, complete };
}
