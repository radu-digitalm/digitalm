"use client";

// Typed client for the finder routes (docs/finder-ux-spec.md §4). The §3.1
// shapes come from the backend's `// @@finder-ux:types` block in
// src/lib/crm/types.ts and are re-exported here for the finder components.
import type { DiscoverySource } from "@/lib/crm/types";
import { AdminFetchError, adminFetch, adminGet } from "./adminFetch";

// ---- §3.1 shapes — the backend's `// @@finder-ux:types` block; re-exported so the
// list, map, card and progress components keep importing them from here.
import type { AreaKind, AreaSelector, GeoPolygon, ResolvedArea, SearchStatus, UnitState, SearchUnit, RegisterScope, SearchProgress, SearchNote, ResultRow, SearchResultV2, SearchSummaryV2 } from "@/lib/crm/types";
export type { AreaKind, AreaSelector, GeoPolygon, ResolvedArea, SearchStatus, UnitState, SearchUnit, RegisterScope, SearchProgress, SearchNote, ResultRow, SearchResultV2, SearchSummaryV2 };
export type Alternative = NonNullable<SearchResultV2["alternatives"]>[number];

// ---- §4 request / response shapes ------------------------------------------------------

export type CustomTrade = { osmKey: string; osmValue: string; label?: string; naf?: string; sic?: string };
export type Pick = { osmType: "relation" | "node" | "way"; osmId: number };
/** `fresh`: "Run again" — every source is read anew instead of from the 24 h cache. */
export type FindBody = { area: string; category: string | CustomTrade; sources?: DiscoverySource[]; pick?: Pick; confirmCap?: boolean; fresh?: boolean };

/** A chip of the over-cap gate; `query` is what a click posts as the area (a department code, "Occitanie, France") — the label otherwise. */
export type GateChild = { id: string; label: string; code?: string; countryCode: string; query?: string };
export type GatePlan = { expected: number | null; cap: number; units: GateChild[]; estimateMs?: number };
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

/** Rows nobody can act on (not listed publicly, closed, hidden) sink to the bottom of every sort; saved rows keep their place. */
export function sinks(r: ResultRow): boolean {
  const why = unsavableReason(r);
  return why === "not_listed" || why === "closed" || why === "hidden";
}

export function notListed(r: ResultRow): boolean {
  return r.diffusion === "partial";
}

/** website + phone + email present, 0–3 (the "Most complete first" sort). */
export function completeness(r: ResultRow): number {
  return (r.website ? 1 : 0) + (r.phone ? 1 : 0) + (r.email ? 1 : 0);
}
