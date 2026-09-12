// The Google-listing check as a decision table (docs/finder-google-spec.md
// §4.5): what an audit does about a prospect's Google listing — pass the
// stored state through, skip (nothing to match on), match (one Text Search),
// reuse the last signals (< 30 days), or fetch fresh signals (one Place
// Details Enterprise) — and the column writes each outcome produces, as data.
// Pure (relative imports, no DB, no I/O): googleCheck.ts runs it with
// googleFetch and enquiriesDb; googleCheckRules.test.ts drives it directly.
import type { GoogleListingReason, GoogleMatch, GoogleSignals } from "../crm/types.ts";
import type { GoogleErrorCode } from "./googleRequests.ts";

export const SIGNALS_MAX_AGE_DAYS = 30;
export const MATCH_RETRY_DAYS = 30;

export type Listing = "unverified" | "found" | "not_found";
export type CheckDecision = "passthrough" | "skip_no_location" | "match" | "signals" | "reuse";

export type DecideInput = {
  on: boolean;
  prospect: { placeId: string | null; listing: Listing; match: GoogleMatch | null; checkedAt: string | null; hasLocation: boolean };
  latestSignals: { fetchedAt: string } | null;
  now: Date;
  /** "Check again": never reuse, always fetch. */
  fresh?: boolean;
};

/** Milliseconds of a SQL ("YYYY-MM-DD HH:MM:SS", UTC) or ISO timestamp; null when unreadable. */
export function stampMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** True when the stamp is missing, unreadable, or at least `days` old. */
export function olderThanDays(stamp: string | null | undefined, now: Date, days: number): boolean {
  const ms = stampMs(stamp);
  if (ms === null) return true;
  return now.getTime() - ms >= days * 86_400_000;
}

/** Whole days since a stamp (the page's "checked 45 days ago"); null when unreadable. */
export function ageDays(stamp: string | null | undefined, now: Date): number | null {
  const ms = stampMs(stamp);
  return ms === null ? null : Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}

/** The decision. Never throws. */
export function decide(input: DecideInput): CheckDecision {
  const { on, prospect, latestSignals, now } = input;
  if (!on) return "passthrough";
  if (!prospect.placeId) {
    // Radu's own verdict (confirm / reject) is never overridden; a stored not_found stays what it is.
    if (prospect.match === "manual" || prospect.listing === "not_found") return "passthrough";
    // A recent automatic miss is not retried for 30 days.
    if (prospect.checkedAt && !olderThanDays(prospect.checkedAt, now, MATCH_RETRY_DAYS)) return "passthrough";
    if (!prospect.hasLocation) return "skip_no_location";
    return "match";
  }
  if (!input.fresh && latestSignals && !olderThanDays(latestSignals.fetchedAt, now, SIGNALS_MAX_AGE_DAYS)) return "reuse";
  return "signals";
}

export type GoogleColumn = "google_place_id" | "google_listing" | "google_match" | "google_checked_at" | "google_confirmed_at";
export type ColumnWrites = Partial<Record<GoogleColumn, string | null>>;

/** SQL timestamp ("YYYY-MM-DD HH:MM:SS", UTC) of a Date. */
export function sqlStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Column writes after a match attempt: a hit sets the place; a miss only stamps the attempt (google_listing untouched). */
export function applyMatch(input: { hit: string | null; now: Date }): { columns: ColumnWrites } {
  const now = sqlStamp(input.now);
  if (input.hit) {
    return { columns: { google_place_id: input.hit, google_listing: "found", google_match: "auto", google_confirmed_at: now, google_checked_at: now } };
  }
  return { columns: { google_match: "auto", google_checked_at: now } };
}

/** Column writes of the manual actions on the prospect page (§4.5). */
export function applyManual(action: "confirm" | "reject" | "clear", input: { placeId?: string | null; now: Date }): { columns: ColumnWrites } {
  const now = sqlStamp(input.now);
  if (action === "confirm") return { columns: { google_place_id: input.placeId ?? null, google_listing: "found", google_match: "manual", google_confirmed_at: now, google_checked_at: now } };
  if (action === "reject") return { columns: { google_place_id: null, google_listing: "not_found", google_match: "manual", google_confirmed_at: now, google_checked_at: now } };
  return { columns: { google_place_id: null, google_listing: "unverified", google_match: null, google_confirmed_at: null, google_checked_at: null } };
}

/** What the checks receive (checks.ts `ChecksInput.google`). */
export type GoogleCheckInput = { status: Listing; signals: GoogleSignals | null; reason?: GoogleListingReason; checkedAt?: string | null };

/** The reason an unmeasured `found` carries when Google could not be asked. */
export function reasonForError(code: GoogleErrorCode | string | undefined): GoogleListingReason {
  return code === "allowance" ? "allowance" : "unavailable";
}

/**
 * The checks input for each outcome. `error` is the Google error code when a
 * request failed (signals stay null and the reason says why); `hit` is the
 * match result when the decision was "match".
 */
export function checkInputFor(
  decision: CheckDecision,
  prospect: DecideInput["prospect"],
  outcome: { signals?: GoogleSignals | null; hit?: string | null; error?: GoogleErrorCode | string | null } = {},
): GoogleCheckInput {
  switch (decision) {
    case "passthrough":
      return prospect.listing === "unverified" && prospect.match === "auto" && prospect.checkedAt
        ? { status: "unverified", signals: null, reason: "no_match", checkedAt: prospect.checkedAt }
        : { status: prospect.listing, signals: null, ...(prospect.checkedAt ? { checkedAt: prospect.checkedAt } : {}) };
    case "skip_no_location":
      return { status: "unverified", signals: null, reason: "no_location" };
    case "match":
      // A hit stands even when the signals fetch that follows it failed; a failed match request stays unverified.
      if (outcome.hit) return outcome.signals ? { status: "found", signals: outcome.signals } : { status: "found", signals: null, reason: reasonForError(outcome.error ?? undefined) };
      if (outcome.error) return { status: "unverified", signals: null, reason: reasonForError(outcome.error) };
      return { status: "unverified", signals: null, reason: "no_match" };
    case "reuse":
    case "signals":
      if (outcome.signals) return { status: "found", signals: outcome.signals };
      return { status: "found", signals: null, reason: reasonForError(outcome.error ?? undefined) };
    default:
      return { status: prospect.listing, signals: null };
  }
}
