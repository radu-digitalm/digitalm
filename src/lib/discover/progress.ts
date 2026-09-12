// The search progress reducer (docs/finder-ux-spec.md §3.2): pure so
// runner.test.ts can drive it. `runner.ts` applies events as units and
// register pages finish, then persists the result; every event is immutable.
import type { RegisterScope, SearchProgress, SearchStatus, SearchUnit, UnitState } from "../crm/types.ts";

export const STALE_MS = 90_000; // a running search whose updatedAt is older than this, with no controller, is interrupted
export const UNIT_ERRORS = ["busy", "timeout", "network"] as const;
export type UnitError = (typeof UNIT_ERRORS)[number];

export type ProgressEvent =
  | { type: "stage"; stage: SearchProgress["stage"]; at: string }
  | { type: "unit_start"; id: string; at: string }
  | { type: "unit_done"; id: string; found: number; truncated?: boolean; at: string }
  | { type: "unit_failed"; id: string; error: UnitError; at: string }
  | { type: "unit_skipped"; id: string; at: string }
  | { type: "unit_reset"; id: string; at: string }
  | { type: "retrying"; until: string | null; at: string }
  | { type: "scope_start"; id: string; at: string }
  | { type: "scope_page"; id: string; pages: number; totalPages: number | null; found: number; at: string }
  | { type: "scope_done"; id: string; at: string }
  | { type: "scope_failed"; id: string; at: string }
  | { type: "scope_reset"; id: string; at: string }
  | { type: "scopes"; scopes: { id: string; label: string }[]; at: string }
  | { type: "found"; found: number; at: string }
  | { type: "merged"; found: number; at: string }
  | { type: "finished"; status: SearchStatus; at: string }
  | { type: "resumed"; at: string }
  | { type: "heartbeat"; at: string };

export function initialProgress(input: { units: { id: string; label: string; code?: string; center: { lat: number; lng: number } }[]; expected: number | null; cap: number; at: string }): SearchProgress {
  return {
    status: "running",
    stage: "osm",
    units: input.units.map((u) => ({ id: u.id, label: u.label, ...(u.code ? { code: u.code } : {}), center: u.center, state: "pending", found: 0 })),
    registerScopes: [],
    found: 0,
    expected: input.expected,
    cap: input.cap,
    rowsVersion: 0,
    retryingUntil: null,
    startedAt: input.at,
    updatedAt: input.at,
    finishedAt: null,
    etaSeconds: null,
  };
}

function unitState(u: SearchUnit, state: UnitState, extra: Partial<SearchUnit> = {}): SearchUnit {
  const next: SearchUnit = { ...u, ...extra, state };
  if (state !== "failed") delete next.error;
  if (!next.truncated) delete next.truncated;
  return next;
}

function mapUnit(p: SearchProgress, id: string, f: (u: SearchUnit) => SearchUnit): SearchUnit[] {
  return p.units.map((u) => (u.id === id ? f(u) : u));
}

function mapScope(p: SearchProgress, id: string, f: (s: RegisterScope) => RegisterScope): RegisterScope[] {
  return p.registerScopes.map((s) => (s.id === id ? f(s) : s));
}

/** Units done ÷ elapsed time → seconds left for the pending ones; null before two finished units. */
export function etaSeconds(p: SearchProgress, at: string): number | null {
  const done = p.units.filter((u) => u.state === "done" || u.state === "failed").length;
  const left = p.units.filter((u) => u.state === "pending" || u.state === "running").length;
  if (done < 2) return null;
  const elapsed = Date.parse(at) - Date.parse(p.startedAt);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  return Math.round(((elapsed / done) * left) / 1000);
}

export function applyEvent(p: SearchProgress, e: ProgressEvent): SearchProgress {
  const base: SearchProgress = { ...p, updatedAt: e.at };
  switch (e.type) {
    case "stage":
      return { ...base, stage: e.stage, retryingUntil: null };
    case "unit_start":
      return { ...base, units: mapUnit(base, e.id, (u) => unitState(u, "running")), retryingUntil: null };
    case "unit_done": {
      const units = mapUnit(base, e.id, (u) => unitState(u, "done", { found: e.found, truncated: e.truncated }));
      const next = { ...base, units, retryingUntil: null };
      return { ...next, etaSeconds: etaSeconds(next, e.at) };
    }
    case "unit_failed": {
      const units = mapUnit(base, e.id, (u) => unitState(u, "failed", { found: 0, error: e.error }));
      const next = { ...base, units, retryingUntil: null };
      return { ...next, etaSeconds: etaSeconds(next, e.at) };
    }
    case "unit_skipped":
      return { ...base, units: mapUnit(base, e.id, (u) => unitState(u, "skipped", { found: 0 })) };
    case "unit_reset":
      return { ...base, units: mapUnit(base, e.id, (u) => unitState(u, "pending", { found: 0 })) };
    case "retrying":
      return { ...base, retryingUntil: e.until };
    case "scopes":
      return { ...base, registerScopes: e.scopes.map((s) => ({ id: s.id, label: s.label, state: "pending", pages: 0, totalPages: null, found: 0 })) };
    case "scope_start":
      return { ...base, registerScopes: mapScope(base, e.id, (s) => ({ ...s, state: "running" })) };
    case "scope_page":
      return { ...base, registerScopes: mapScope(base, e.id, (s) => ({ ...s, state: "running", pages: e.pages, totalPages: e.totalPages, found: e.found })) };
    case "scope_done":
      return { ...base, registerScopes: mapScope(base, e.id, (s) => ({ ...s, state: "done" })) };
    case "scope_failed":
      return { ...base, registerScopes: mapScope(base, e.id, (s) => ({ ...s, state: "failed" })) };
    case "scope_reset":
      return { ...base, registerScopes: mapScope(base, e.id, (s) => ({ ...s, state: "pending", pages: 0, found: 0 })) };
    case "found":
      return { ...base, found: e.found };
    case "merged":
      return { ...base, stage: "merge", found: e.found, rowsVersion: p.rowsVersion + 1 };
    case "finished":
      return { ...base, status: e.status, stage: "finished", finishedAt: e.at, retryingUntil: null, etaSeconds: null, units: base.units.map((u) => (u.state === "running" ? unitState(u, "pending") : u)) };
    case "resumed":
      return {
        ...base,
        status: "running",
        stage: "osm",
        finishedAt: null,
        retryingUntil: null,
        etaSeconds: null,
        startedAt: e.at,
        units: base.units.map((u) => (u.state === "done" ? u : unitState(u, "pending", { found: 0 }))),
        registerScopes: base.registerScopes.map((s) => (s.state === "done" ? s : { ...s, state: "pending", pages: 0, found: 0 })),
      };
    case "heartbeat":
      return base;
    default:
      return base;
  }
}

/**
 * Final status (§3.2): `cancelled` when stopped by the owner, `capped` when
 * the cap stopped it, `partial` when anything failed or the time limit hit,
 * `failed` when nothing at all could run, else `done`.
 */
export function resolveStatus(p: SearchProgress, flags: { cancelled?: boolean; capped?: boolean; timeLimit?: boolean } = {}): SearchStatus {
  if (flags.cancelled) return "cancelled";
  const units = p.units;
  const anyDone = units.some((u) => u.state === "done") || p.registerScopes.some((s) => s.state === "done");
  const anyFailed = units.some((u) => u.state === "failed") || p.registerScopes.some((s) => s.state === "failed");
  if (!anyDone && anyFailed && p.found === 0) return "failed";
  if (flags.capped) return "capped";
  if (anyFailed || flags.timeLimit) return "partial";
  return "done";
}

/** A `running` search with a stale heartbeat and no live controller was interrupted by a restart. */
export function isInterrupted(p: Pick<SearchProgress, "status" | "updatedAt">, hasController: boolean, now = Date.now(), staleMs = STALE_MS): boolean {
  if (p.status !== "running" || hasController) return false;
  const t = Date.parse(p.updatedAt);
  return !Number.isFinite(t) || now - t > staleMs;
}

/** Legacy `searches` rows (status NULL): done, or partial when the old flag was set. */
export function legacyStatus(status: string | null | undefined, partial: number | boolean | null | undefined): SearchStatus {
  const known: SearchStatus[] = ["running", "done", "capped", "partial", "failed", "cancelled", "interrupted", "expired"];
  if (status && (known as string[]).includes(status)) return status as SearchStatus;
  return partial ? "partial" : "done";
}

export function unitsFinished(p: SearchProgress): number {
  return p.units.filter((u) => u.state === "done" || u.state === "failed" || u.state === "skipped").length;
}
