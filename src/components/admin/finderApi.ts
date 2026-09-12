"use client";

// Typed client for the finder routes (docs/finder-ux-spec.md §4). The shapes
// below restate §3.1 so the frontend builds before the backend's
// `// @@finder-ux:types` block lands in src/lib/crm/types.ts — at integration
// the type declarations here become `import type { … } from "@/lib/crm/types"`
// (same names, same fields) and the functions stay as they are.
import type { Business, DiscoverySource } from "@/lib/crm/types";
import { AdminFetchError, adminFetch, adminGet } from "./adminFetch";

// ---- §3.1 shapes --------------------------------------------------------------------

export type AreaKind = "town" | "postcode" | "department" | "region" | "country" | "place";
export type AreaSelector = { kind: "relation"; relId: number } | { kind: "insee"; codes: string[] } | { kind: "around"; lat: number; lng: number; m: number };
export interface GeoPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}
export interface ResolvedArea {
  label: string;
  countryCode: string;
  center: { lat: number; lng: number };
  bbox: [south: number, west: number, north: number, east: number];
  admin?: { postcodes?: string[]; inseeCode?: string; departement?: string; locality?: string; inseeCodes?: string[]; departements?: string[]; regionCode?: string };
  provider: "geo_gouv" | "nominatim";
  kind: AreaKind;
  countryName: string;
  polygon: GeoPolygon | null;
  polygonApprox?: boolean;
  osmRelationId?: number;
  areaSelector: AreaSelector;
  radiusKm: number;
}
export type SearchStatus = "running" | "done" | "capped" | "partial" | "failed" | "cancelled" | "interrupted" | "expired";
export type UnitState = "pending" | "running" | "done" | "failed" | "skipped";
export interface SearchUnit {
  id: string;
  label: string;
  code?: string;
  center: { lat: number; lng: number };
  state: UnitState;
  found: number;
  truncated?: boolean;
  error?: string;
}
export interface RegisterScope {
  id: string;
  label: string;
  state: UnitState;
  pages: number;
  totalPages: number | null;
  found: number;
}
export interface SearchProgress {
  status: SearchStatus;
  stage: "osm" | "register" | "merge" | "finished";
  units: SearchUnit[];
  registerScopes: RegisterScope[];
  found: number;
  expected: number | null;
  cap: number;
  rowsVersion: number;
  retryingUntil?: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  etaSeconds: number | null;
}
export interface SearchNote {
  code: string;
  text: string;
  params?: Record<string, string | number>;
}
export interface ResultRow extends Business {
  key: string;
  sources: DiscoverySource[];
  provenance: Partial<Record<"website" | "phone" | "email" | "geo" | "address" | "name", DiscoverySource>>;
  inside: "yes" | "approx" | "no";
  distanceKm: number | null;
  cityApprox?: boolean;
  socials?: Record<string, string>;
  countryName: string;
  countrySource: "source" | "area";
  hidden?: boolean;
  unitId?: string;
  readAt?: string;
}
export interface Alternative {
  osmType: "relation" | "node" | "way";
  osmId: number;
  label: string;
  kind: AreaKind;
  countryCode: string;
  countryName: string;
}
export interface SearchResultV2 {
  version: 2;
  searchId: number;
  queryArea: string;
  area: ResolvedArea;
  category: { key: string; label: { fr: string; en: string }; custom: boolean };
  sources: DiscoverySource[];
  rows: ResultRow[];
  total: number;
  perSource: Partial<Record<DiscoverySource, number>>;
  progress: SearchProgress;
  notes: SearchNote[];
  alternatives?: Alternative[];
  durationMs: number | null;
  createdAt: string;
}
export interface SearchSummaryV2 {
  id: number;
  queryArea: string;
  areaLabel: string;
  areaKind: AreaKind | null;
  countryCode: string;
  countryName: string;
  categoryKey: string;
  categoryLabel: string;
  sources: DiscoverySource[];
  resultCount: number;
  perSource: Partial<Record<DiscoverySource, number>>;
  savedCount: number;
  status: SearchStatus;
  durationMs: number | null;
  createdAt: string;
  cached: boolean;
}

// ---- §4 request / response shapes ------------------------------------------------------

export type CustomTrade = { osmKey: string; osmValue: string; label?: string; naf?: string; sic?: string };
export type Pick = { osmType: "relation" | "node" | "way"; osmId: number };
export type FindBody = { area: string; category: string | CustomTrade; sources?: DiscoverySource[]; pick?: Pick; confirmCap?: boolean };

export type GateChild = { id: string; label: string; code?: string; countryCode: string };
export type GatePlan = { expected: number; cap: number; units: GateChild[]; estimateMs?: number };
export type StartResponse = { ok: true; searchId: number; area: ResolvedArea; plan: { expected: number | null; cap: number; units: number; estimateMs?: number }; alternatives?: Alternative[] };
export type GateResponse = { ok: true; gate: "over_cap"; area: ResolvedArea; plan: GatePlan };
export type FindResponse = StartResponse | GateResponse;

export type Candidate = { osmType: "relation" | "node" | "way"; osmId: number; label: string; kind: AreaKind; countryCode: string; countryName: string };

export type SaveResponse = {
  ok: true;
  saved: number;
  auditsQueued: number;
  withoutWebsite: number;
  alreadySaved: number;
  unknown: number;
  references: string[];
  prospectIds?: number[];
};

export const TERMINAL: readonly SearchStatus[] = ["done", "capped", "partial", "failed", "cancelled", "interrupted", "expired"];

export function isTerminal(status: SearchStatus | null | undefined): boolean {
  return !!status && TERMINAL.includes(status);
}

export function isGate(r: FindResponse): r is GateResponse {
  return (r as GateResponse).gate === "over_cap";
}

/** The error shapes a POST /api/admin/find can answer with (409s carry data). */
export type FindError =
  | { kind: "ambiguous"; candidates: Candidate[] }
  | { kind: "search_running"; searchId: number; area: string; trade: string }
  | { kind: "code"; code: string; status: number; message?: string };

export function classifyFindError(e: unknown): FindError {
  if (e instanceof AdminFetchError) {
    const body = (e.body ?? {}) as Record<string, unknown>;
    if (e.code === "ambiguous" && Array.isArray(body.candidates)) return { kind: "ambiguous", candidates: body.candidates as Candidate[] };
    if (e.code === "search_running") return { kind: "search_running", searchId: Number(body.searchId ?? 0), area: String(body.area ?? ""), trade: String(body.trade ?? "") };
    return { kind: "code", code: e.code, status: e.status, message: typeof body.message === "string" ? body.message : undefined };
  }
  return { kind: "code", code: "search_failed", status: 0 };
}

export function startFind(body: FindBody): Promise<FindResponse> {
  return adminFetch<FindResponse>("/api/admin/find", body);
}

/** GET ?id=&after=&v= — a slice from index `after` unless the rows were reordered (then the full list, see §4). */
export function getFind(id: number, after?: number, v?: number): Promise<SearchResultV2 & { ok: true }> {
  const q = new URLSearchParams({ id: String(id) });
  if (after !== undefined && v !== undefined) {
    q.set("after", String(after));
    q.set("v", String(v));
  }
  return adminGet<SearchResultV2 & { ok: true }>(`/api/admin/find?${q.toString()}`);
}

export function cancelFind(searchId: number): Promise<{ ok: true; status: SearchStatus }> {
  return adminFetch("/api/admin/find/cancel", { searchId });
}

export function continueFind(searchId: number): Promise<{ ok: true; searchId: number }> {
  return adminFetch("/api/admin/find/continue", { searchId });
}

export function dismissFind(searchId: number, key: string, undo = false): Promise<{ ok: true; hidden: string[] }> {
  return adminFetch("/api/admin/find/dismiss", { searchId, key, undo });
}

export function saveFind(searchId: number, picks: string[]): Promise<SaveResponse> {
  return adminFetch<SaveResponse>("/api/admin/find/save", { searchId, picks });
}

export function recentFinds(limit = 20): Promise<{ ok: true; searches: SearchSummaryV2[] }> {
  return adminGet(`/api/admin/find/recent?limit=${limit}`);
}

export function backfillTowns(): Promise<{ ok: true; filled: number; remaining: number }> {
  return adminFetch("/api/admin/prospects/backfill-towns", {});
}

// ---- row helpers shared by the list, the map and the card ----------------------------------

/** Rows with source coordinates get a pin; centre-filled or coordinate-less rows never do (§5.3). */
export function hasPin(r: ResultRow): boolean {
  return r.geoSource === "source" && typeof r.lat === "number" && typeof r.lng === "number" && Number.isFinite(r.lat) && Number.isFinite(r.lng);
}

export type RowStatus = "saved" | "not_listed" | "closed" | "chain" | "outside" | "hidden" | null;

export function rowStatus(r: ResultRow): RowStatus {
  if (r.hidden) return "hidden";
  if (r.alreadySaved) return "saved";
  if (r.diffusion === "partial") return "not_listed";
  if (r.active === false) return "closed";
  if (r.inside === "no") return "outside";
  if (r.brand) return "chain";
  return null;
}

/** Why a row cannot be saved, or null when it can. */
export function unsavableReason(r: ResultRow): "saved" | "not_listed" | "closed" | "hidden" | null {
  if (r.hidden) return "hidden";
  if (r.alreadySaved) return "saved";
  if (r.diffusion === "partial") return "not_listed";
  if (r.active === false) return "closed";
  return null;
}

export function savable(r: ResultRow): boolean {
  return unsavableReason(r) === null;
}

/** website + phone + email present, 0–3 (the "Most complete first" sort). */
export function completeness(r: ResultRow): number {
  return (r.website ? 1 : 0) + (r.phone ? 1 : 0) + (r.email ? 1 : 0);
}
