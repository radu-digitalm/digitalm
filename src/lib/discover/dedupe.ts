// Cross-source dedupe of discovery results (contract §6 "Search / dedupe / save").
// Two rows are the same business when (1) source + sourceId match, (2) both
// have a website with the same registrable domain, or (3) their normalised
// names are equal AND they sit within 150 m — or share a postcode when one
// side has no coordinates. Merged rows keep the register identity (SIRET /
// company number, legal name, legal form, sole-trader flag, diffusion), the
// OSM website / phone / email / coordinates, and list every source.
//
// Pure module: only classify.ts helpers, so dedupe.test.ts runs it under
// node --test without Next or the DB.
import { domainOf, haversineM, normaliseName } from "../crm/classify.ts";
import type { Business, DiscoverySource } from "../crm/types.ts";

export const SAME_PLACE_M = 150;

/** Which source each stored value came from — stored as prospects.*_source. */
export type Provenance = Partial<Record<"website" | "phone" | "email" | "geo" | "address" | "name", DiscoverySource>>;

export type MergedBusiness = Business & {
  /** "<source>:<sourceId>" of the identity row — the pick key on the results table. */
  key: string;
  sources: DiscoverySource[];
  provenance: Provenance;
  /** "<source>:<sourceId>" of every row folded into this one (identity row first). */
  members: string[];
};

/** Register sources win the identity of a merged row; OSM wins geo/contact. */
const IDENTITY_RANK: Record<DiscoverySource, number> = { fr_register: 0, companies_house: 1, google: 2, osm: 3 };
const CONTACT_RANK: Record<DiscoverySource, number> = { osm: 0, google: 1, fr_register: 2, companies_house: 3 };

export function nameKeyOf(b: Pick<Business, "name" | "enseigne" | "legalName">): string {
  return normaliseName(b.name || b.enseigne || b.legalName || "");
}

function hasGeo(b: Pick<Business, "lat" | "lng" | "geoSource">): b is Business & { lat: number; lng: number } {
  return typeof b.lat === "number" && typeof b.lng === "number" && Number.isFinite(b.lat) && Number.isFinite(b.lng) && b.geoSource === "source";
}

function postcodeOf(b: Pick<Business, "postcode">): string {
  return (b.postcode ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Rule 3 on its own: equal normalised names and (within 150 m, or the same
 * postcode when a side has no source coordinates). Used both for merging
 * results and for the "already saved" match against stored prospects.
 */
export function sameByNameAndPlace(
  a: Pick<Business, "name" | "enseigne" | "legalName" | "lat" | "lng" | "geoSource" | "postcode">,
  b: Pick<Business, "name" | "enseigne" | "legalName" | "lat" | "lng" | "geoSource" | "postcode">,
): boolean {
  const ka = nameKeyOf(a);
  if (!ka || ka !== nameKeyOf(b)) return false;
  if (hasGeo(a) && hasGeo(b)) return haversineM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) < SAME_PLACE_M;
  const pa = postcodeOf(a);
  return pa.length > 0 && pa === postcodeOf(b);
}

/** Registrable domain of a business's website, or null. */
export function domainKeyOf(b: Pick<Business, "website">): string | null {
  return b.website ? domainOf(b.website) : null;
}

// ---- union-find over the input list ---------------------------------------------

function find(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
}

function union(parent: number[], a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

function pickBy<T extends Business>(rows: T[], rank: Record<DiscoverySource, number>, has: (r: T) => boolean): T | undefined {
  return rows.filter(has).sort((x, y) => rank[x.source] - rank[y.source])[0];
}

function mergeCluster(rows: Business[]): MergedBusiness {
  const byIdentity = [...rows].sort((x, y) => IDENTITY_RANK[x.source] - IDENTITY_RANK[y.source]);
  const identity = byIdentity[0]!;
  const sources = [...new Set(rows.flatMap((r) => r.sources ?? [r.source]))].sort((x, y) => IDENTITY_RANK[x] - IDENTITY_RANK[y]);
  const provenance: Provenance = {};

  // Name shown in the list: the shop sign as OSM sees it, else the register's.
  const nameRow = pickBy(rows, CONTACT_RANK, (r) => !!r.name) ?? identity;
  provenance.name = nameRow.source;

  const webRow = pickBy(rows, CONTACT_RANK, (r) => !!r.website);
  const phoneRow = pickBy(rows, CONTACT_RANK, (r) => !!r.phone);
  const emailRow = pickBy(rows, CONTACT_RANK, (r) => !!r.email);
  const geoRow = pickBy(rows, CONTACT_RANK, (r) => hasGeo(r)) ?? pickBy(rows, CONTACT_RANK, (r) => typeof r.lat === "number" && typeof r.lng === "number");
  const addrRow = pickBy(rows, CONTACT_RANK, (r) => !!r.addressLine && !!r.postcode) ?? pickBy(rows, IDENTITY_RANK, (r) => !!r.postcode) ?? identity;
  if (webRow) provenance.website = webRow.source;
  if (phoneRow) provenance.phone = phoneRow.source;
  if (emailRow) provenance.email = emailRow.source;
  if (geoRow) provenance.geo = geoRow.source;
  provenance.address = addrRow.source;

  const registerRow = rows.find((r) => r.registerId) ?? identity;
  const merged: MergedBusiness = {
    ...identity,
    key: `${identity.source}:${identity.sourceId}`,
    sources,
    provenance,
    members: [...new Set(byIdentity.map((r) => `${r.source}:${r.sourceId}`))],
    name: nameRow.name,
    legalName: registerRow.legalName ?? identity.legalName,
    enseigne: registerRow.enseigne ?? rows.find((r) => r.enseigne)?.enseigne ?? (nameRow !== identity ? nameRow.name : undefined),
    addressLine: addrRow.addressLine ?? identity.addressLine,
    postcode: addrRow.postcode ?? rows.find((r) => r.postcode)?.postcode,
    city: addrRow.city ?? rows.find((r) => r.city)?.city,
    region: addrRow.region ?? rows.find((r) => r.region)?.region,
    lat: geoRow?.lat,
    lng: geoRow?.lng,
    geoSource: geoRow ? geoRow.geoSource : "none",
    website: webRow?.website,
    phone: phoneRow?.phone,
    email: emailRow?.email,
    registerId: registerRow.registerId,
    legalForm: registerRow.legalForm,
    soleTrader: registerRow.soleTrader,
    diffusion: registerRow.diffusion,
    active: registerRow.active,
    brand: rows.find((r) => r.brand)?.brand,
    // A registered office is only "the shop" when no other source placed it on the map.
    registeredOfficeOnly: rows.every((r) => r.registeredOfficeOnly) ? true : undefined,
    tags: Object.assign({}, ...rows.map((r) => r.tags ?? {})),
  };
  // finder-google: the place id a Google place attached to any member (first by identity rank) travels with the merged row.
  const placeId = byIdentity.find((r) => typeof r.googlePlaceId === "string" && r.googlePlaceId)?.googlePlaceId;
  if (placeId) merged.googlePlaceId = placeId;
  else delete merged.googlePlaceId;
  if (merged.registeredOfficeOnly === undefined) delete merged.registeredOfficeOnly;
  if (!merged.tags || Object.keys(merged.tags).length === 0) delete merged.tags;
  return merged;
}

/**
 * Merge a list of businesses from one or more adapters. Order of the output:
 * clusters in order of first appearance. Never throws on odd input.
 */
export function mergeBusinesses(input: Business[]): MergedBusiness[] {
  const rows = input.filter((b) => b && typeof b.name === "string" && b.name.trim().length > 0);
  const parent = rows.map((_, i) => i);

  // Rule 1: same source + sourceId.
  const byId = new Map<string, number>();
  // Rule 2: same registrable domain.
  const byDomain = new Map<string, number>();
  // Rule 3 candidates: same normalised name.
  const byName = new Map<string, number[]>();

  rows.forEach((b, i) => {
    const id = `${b.source}:${b.sourceId}`;
    const seen = byId.get(id);
    if (seen !== undefined) union(parent, seen, i);
    else byId.set(id, i);

    const dk = domainKeyOf(b);
    if (dk) {
      const seenDomain = byDomain.get(dk);
      if (seenDomain !== undefined) union(parent, seenDomain, i);
      else byDomain.set(dk, i);
    }

    const nk = nameKeyOf(b);
    if (nk) {
      const list = byName.get(nk) ?? [];
      for (const j of list) {
        if (find(parent, j) !== find(parent, i) && sameByNameAndPlace(rows[j]!, b)) union(parent, j, i);
      }
      list.push(i);
      byName.set(nk, list);
    }
  });

  const clusters = new Map<number, Business[]>();
  rows.forEach((b, i) => {
    const root = find(parent, i);
    const list = clusters.get(root) ?? [];
    list.push(b);
    clusters.set(root, list);
  });
  return [...clusters.values()].map(mergeCluster);
}
