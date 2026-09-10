// Trade categories for discovery (contract §6 "Categories"): 19 fixed keys
// mapped to OSM tags, NAF rév. 2 codes (FR register) and UK SIC 2007 codes
// (Companies House), plus free-text "custom" trades built from an OSM key/value
// pair. Pure module — no imports beyond types — so categories.test.ts can load
// it under node --test in strip-only mode.
//
// NAF / SIC codes re-checked against the INSEE NAF rév. 2 and ONS SIC 2007
// lists on 10 Sep 2026 (10.71C = boulangerie et boulangerie-pâtisserie;
// bakery SIC keeps manufacture 10710 + retail 47240).
import type { Category } from "../crm/types.ts";

function cat(key: string, fr: string, en: string, osm: [string, string][], naf: string[], sic: string[]): Category {
  return { key, label: { fr, en }, osm: osm.map(([k, v]) => ({ k, v })), naf, sic };
}

export const CATEGORIES: readonly Category[] = [
  cat("restaurant", "Restaurant", "Restaurant", [["amenity", "restaurant"]], ["56.10A"], ["56101"]),
  cat("bar", "Bar", "Bar / pub", [["amenity", "bar"], ["amenity", "pub"]], ["56.30Z"], ["56302"]),
  cat("hotel", "Hôtel", "Hotel", [["tourism", "hotel"]], ["55.10Z"], ["55100"]),
  cat("gite", "Gîte / chambre d'hôtes", "Guest house / holiday let", [["tourism", "guest_house"], ["tourism", "chalet"]], ["55.20Z"], ["55209"]),
  cat("campsite", "Camping", "Campsite", [["tourism", "camp_site"]], ["55.30Z"], ["55300"]),
  cat("bakery", "Boulangerie", "Bakery", [["shop", "bakery"]], ["10.71C"], ["10710", "47240"]),
  cat("butcher", "Boucherie", "Butcher", [["shop", "butcher"]], ["47.22Z"], ["47220"]),
  cat("hairdresser", "Coiffeur", "Hairdresser", [["shop", "hairdresser"]], ["96.02A"], ["96020"]),
  cat("beauty", "Institut de beauté", "Beauty salon", [["shop", "beauty"]], ["96.02B"], ["96020"]),
  cat("garage", "Garage automobile", "Car repair garage", [["shop", "car_repair"]], ["45.20A"], ["45200"]),
  cat("plumber", "Plombier", "Plumber", [["craft", "plumber"]], ["43.22A"], ["43220"]),
  cat("electrician", "Électricien", "Electrician", [["craft", "electrician"]], ["43.21A"], ["43210"]),
  cat("joiner", "Menuisier", "Joiner / carpenter", [["craft", "carpenter"], ["craft", "joiner"]], ["43.32A"], ["43320"]),
  cat("painter", "Peintre en bâtiment", "Painter and decorator", [["craft", "painter"]], ["43.34Z"], ["43341"]),
  cat("roofer", "Couvreur", "Roofer", [["craft", "roofer"]], ["43.91B"], ["43910"]),
  cat("estate_agent", "Agence immobilière", "Estate agent", [["office", "estate_agent"]], ["68.31Z"], ["68310"]),
  cat("optician", "Opticien", "Optician", [["shop", "optician"]], ["47.78A"], ["47782"]),
  cat("dentist", "Dentiste", "Dentist", [["amenity", "dentist"]], ["86.23Z"], ["86230"]),
  cat("gym", "Salle de sport", "Gym / fitness centre", [["leisure", "fitness_centre"]], ["93.13Z"], ["93130"]),
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** A fixed category by key, or null. */
export function categoryByKey(key: string): Category | null {
  return BY_KEY.get(key) ?? null;
}

// ---- custom trades ------------------------------------------------------------

/** OSM primary keys a custom trade may use (the select in FindForm). */
export const OSM_KEYS = ["amenity", "shop", "craft", "office", "tourism", "leisure", "healthcare"] as const;
export type OsmKey = (typeof OSM_KEYS)[number];

export const OSM_VALUE_RE = /^[a-z_]{2,40}$/;
export const NAF_RE = /^\d\d\.\d\d[A-Z]$/;
export const SIC_RE = /^\d{5}$/;

export type CustomTradeInput = {
  osmKey: string;
  osmValue: string;
  label?: string;
  naf?: string;
  sic?: string;
};

/** "custom:<slug>" for an OSM value — the key stored in searches.category_key. */
export function customKey(osmValue: string): string {
  return `custom:${osmValue.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

/** Human label for a custom trade: the given label, else the OSM value with underscores as spaces. */
function customLabel(input: CustomTradeInput): string {
  const given = (input.label ?? "").trim().slice(0, 60);
  if (given) return given;
  return input.osmValue.replace(/_/g, " ");
}

/**
 * Build a custom Category from the "Other trade" form. Returns null when the
 * OSM key is not in OSM_KEYS, the value is not [a-z_]{2,40}, or an optional
 * NAF / SIC code is malformed. Custom trades search OSM only unless a NAF or
 * SIC code was given.
 */
export function customCategory(input: CustomTradeInput): Category | null {
  const osmKey = String(input.osmKey ?? "").trim();
  const osmValue = String(input.osmValue ?? "").trim().toLowerCase();
  if (!(OSM_KEYS as readonly string[]).includes(osmKey)) return null;
  if (!OSM_VALUE_RE.test(osmValue)) return null;
  const naf = (input.naf ?? "").trim().toUpperCase();
  const sic = (input.sic ?? "").trim();
  if (naf && !NAF_RE.test(naf)) return null;
  if (sic && !SIC_RE.test(sic)) return null;
  const label = customLabel({ ...input, osmValue });
  return {
    key: customKey(osmValue),
    label: { fr: label, en: label },
    osm: [{ k: osmKey, v: osmValue }],
    naf: naf ? [naf] : [],
    sic: sic ? [sic] : [],
    custom: true,
  };
}

/**
 * Parse the `category` field of POST /api/admin/find: a fixed key as a string,
 * or a custom-trade object. Null when nothing valid comes out.
 */
export function parseCategory(input: unknown): Category | null {
  if (typeof input === "string") return categoryByKey(input.trim());
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.key === "string" && !o.key.startsWith("custom:")) return categoryByKey(o.key);
  // Accept both the form shape {osmKey, osmValue} and a Category-like {osm:[{k,v}]}.
  let osmKey = typeof o.osmKey === "string" ? o.osmKey : "";
  let osmValue = typeof o.osmValue === "string" ? o.osmValue : "";
  if (!osmKey && Array.isArray(o.osm) && o.osm[0] && typeof o.osm[0] === "object") {
    const first = o.osm[0] as Record<string, unknown>;
    osmKey = typeof first.k === "string" ? first.k : "";
    osmValue = typeof first.v === "string" ? first.v : "";
  }
  const naf = Array.isArray(o.naf) ? String(o.naf[0] ?? "") : typeof o.naf === "string" ? o.naf : "";
  const sic = Array.isArray(o.sic) ? String(o.sic[0] ?? "") : typeof o.sic === "string" ? o.sic : "";
  const label = typeof o.label === "string" ? o.label : o.label && typeof o.label === "object" ? String((o.label as { en?: unknown }).en ?? "") : "";
  return customCategory({ osmKey, osmValue, naf, sic, label });
}

/** What prospects.trade_key stores: the fixed key, or the label of a custom trade. */
export function tradeKeyFor(category: Category): string {
  return category.custom ? category.label.en : category.key;
}

/** Display label for a stored trade_key (fixed key → EN label; custom label as is). */
export function tradeLabel(tradeKey: string | null | undefined, locale: "fr" | "en" = "en"): string | null {
  if (!tradeKey) return null;
  const c = BY_KEY.get(tradeKey);
  return c ? c.label[locale] : tradeKey;
}
