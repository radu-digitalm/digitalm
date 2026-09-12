// Is a Google place inside the search area? (docs/finder-google-spec.md §4.3
// "Inside filter", rule §3.3.) Decided from the place's ADDRESS COMPONENTS
// only — country, postcode, department / region names, locality — never from
// its coordinates: the terms forbid point-in-polygon analysis on Places
// content, so this module does not import polygon.ts at all. "yes" keeps the
// place, "no" drops it (counted), "approx" keeps it when the address says
// nothing either way. Pure: classify.ts (name normalisation) only.
import { normaliseName } from "../crm/classify.ts";
import type { ResolvedArea } from "../crm/types.ts";

export type Inside = "yes" | "approx" | "no";

/** The address fields the decision reads — a subset of GooglePlace. */
export type PlaceAddress = {
  postcode: string | null;
  country: string | null;
  adminLevel1: string | null;
  adminLevel2: string | null;
  locality: string | null;
  postalTown: string | null;
};

export type InsideArea = Pick<ResolvedArea, "kind" | "countryCode" | "label" | "admin">;

/** Postcode prefix of a French department code: "09" → "09", "2A" / "2B" → "20", "971" → "971". */
export function postcodePrefixOf(departement: string): string {
  const d = departement.toUpperCase();
  if (d === "2A" || d === "2B") return "20";
  return d;
}

/** Department code(s) a French postcode belongs to; [] when it is not five digits. */
export function departementsOfFrPostcode(postcode: string): string[] {
  const pc = postcode.replace(/\s+/g, "");
  if (!/^\d{5}$/.test(pc)) return [];
  if (pc.startsWith("97") || pc.startsWith("98")) return [pc.slice(0, 3)];
  if (pc.startsWith("20")) return ["2A", "2B"];
  return [pc.slice(0, 2)];
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ka = normaliseName(a);
  return ka.length > 0 && ka === normaliseName(b);
}

/** "Cambridge, England" → ["Cambridge, England", "Cambridge"]; "within 4 km of Foix" → [..., "Foix"]. */
function labelNames(label: string): string[] {
  const out = [label];
  const comma = label.indexOf(",");
  if (comma > 0) out.push(label.slice(0, comma));
  const within = /^within [\d.,]+ km of (.+)$/i.exec(label);
  if (within) out.push(within[1]!);
  return out;
}

function anySame(value: string | null, names: readonly string[]): boolean {
  return names.some((n) => same(value, n));
}

function verdict(yes: boolean, present: boolean): Inside {
  return yes ? "yes" : present ? "no" : "approx";
}

/**
 * Country first (a different country is always "no"), then by kind. A
 * present-but-different component says "no"; a missing one says "approx".
 */
export function googleInside(place: PlaceAddress, area: InsideArea): Inside {
  const cc = (area.countryCode ?? "").toUpperCase();
  if (place.country && cc && place.country.toUpperCase() !== cc) return "no";
  const names = labelNames(area.label ?? "");
  const admin = area.admin ?? {};
  const postcode = (place.postcode ?? "").replace(/\s+/g, "").toUpperCase();
  const townNames = [...names, ...(admin.locality ? [admin.locality] : [])];

  switch (area.kind) {
    case "country":
      return "yes";
    case "place":
      return "yes";
    case "department": {
      if (cc === "FR" && admin.departement) {
        const prefix = postcodePrefixOf(admin.departement);
        if (postcode) return verdict(/^\d{5}$/.test(postcode) && postcode.startsWith(prefix), true);
        return verdict(anySame(place.adminLevel2, names), !!place.adminLevel2);
      }
      const named = anySame(place.adminLevel2, names) || anySame(place.adminLevel1, names);
      return verdict(named, !!(place.adminLevel1 || place.adminLevel2));
    }
    case "region": {
      if (cc === "FR") {
        if (postcode && admin.departements && admin.departements.length > 0) {
          const deps = departementsOfFrPostcode(postcode);
          if (deps.length > 0) return verdict(deps.some((d) => admin.departements!.includes(d)), true);
        }
        return verdict(anySame(place.adminLevel1, names), !!place.adminLevel1);
      }
      const named = anySame(place.adminLevel1, names) || anySame(place.adminLevel2, names);
      return verdict(named, !!(place.adminLevel1 || place.adminLevel2));
    }
    case "town":
    case "postcode": {
      const postcodes = (admin.postcodes ?? []).map((p) => p.replace(/\s+/g, "").toUpperCase());
      if (anySame(place.locality, townNames) || anySame(place.postalTown, townNames)) return "yes";
      if (postcode && postcodes.length > 0) return verdict(postcodes.includes(postcode), true);
      return verdict(false, !!(place.locality || place.postalTown));
    }
    default:
      return "approx";
  }
}
