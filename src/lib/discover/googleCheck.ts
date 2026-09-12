// The Google-listing check with I/O (docs/finder-google-spec.md §4.5): runs
// the decision table of googleCheckRules.ts with googleFetch and the
// prospect store — one Text Search Pro to match a saved prospect, one Place
// Details Enterprise for the derived signals —, and the manual-match
// candidates of the prospect page. Nothing from Google is cached (apiCache is
// never imported) and nothing from a response body is logged; the transient
// candidates leave this module only towards the route that asked for them.
import { googleSignals, updateGoogleColumns } from "@/lib/prospects/store";
import { parseJson } from "@/lib/crm/db";
import { sqlNow } from "@/lib/crm/time";
import type { AuditChecks, FitSuggestion, Flag, GoogleCandidate, GoogleSignals } from "@/lib/crm/types";
import { enquiriesDb } from "@/lib/enquiries";
import { googleListing } from "@/lib/audit/checks";
import { auditScore } from "@/lib/audit/score";
import { tradeLabel } from "./categories";
import { GoogleError, googleFetch, googlePlacesOn, type GoogleErrorCode, type GooglePool, googleAllowance } from "./google";
import { applyMatch, checkInputFor, decide, type CheckDecision, type ColumnWrites, type GoogleCheckInput, type Listing } from "./googleCheckRules";
import { PROSPECT_MATCH_MAX_M, matchPlace } from "./googleMatch";
import { MASK_DETAILS_ENTERPRISE, MASK_SEARCH_PRO, candidatesOf, matchSearchBody, parseSearch, signalsOf } from "./googleRequests";

/** What the check needs of a prospect (the audit job's row or a ProspectRecord). */
export type CheckProspect = {
  id: number;
  name: string;
  tradeKey: string | null;
  country: string;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  googleListing: Listing;
  googleMatch: "auto" | "manual" | null;
  googleCheckedAt: string | null;
};

export type GoogleCheckOutcome = {
  decision: CheckDecision;
  /** For checks.ts `ChecksInput.google`. */
  google: GoogleCheckInput;
  /** Column writes the caller applies (or already applied with `apply`). */
  columns: ColumnWrites;
  signals: GoogleSignals | null;
  error?: GoogleErrorCode;
  /** The pool an `allowance` error belongs to. */
  errorPool?: GooglePool;
  /** Whether a Google request was made. */
  requested: boolean;
};

export type CheckOptions = { fresh?: boolean; signal?: AbortSignal; retry?: boolean; apply?: boolean; now?: Date };

function codeOf(e: unknown): GoogleErrorCode {
  return e instanceof GoogleError ? e.code : "unavailable";
}

function hasPoint(p: Pick<CheckProspect, "lat" | "lng">): boolean {
  return typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** The trade words stripped before names are compared. */
function stripWordsFor(p: Pick<CheckProspect, "tradeKey">): string[] {
  const words = [tradeLabel(p.tradeKey, "fr"), tradeLabel(p.tradeKey, "en")];
  return words.filter((w): w is string => !!w);
}

/** One Place Details Enterprise → the derived signals. Throws GoogleError. */
export async function fetchSignals(placeId: string, opts: { signal?: AbortSignal; retry?: boolean } = {}): Promise<GoogleSignals> {
  const json = await googleFetch<unknown>("details_enterprise", `/v1/places/${encodeURIComponent(placeId)}?languageCode=en`, {
    method: "GET",
    mask: MASK_DETAILS_ENTERPRISE,
    signal: opts.signal,
    retry: opts.retry === true,
  });
  return signalsOf(json, new Date());
}

async function searchForProspect(p: CheckProspect, opts: { signal?: AbortSignal; retry?: boolean }) {
  const body = matchSearchBody({ name: p.name, city: p.city, lat: hasPoint(p) ? p.lat : null, lng: hasPoint(p) ? p.lng : null, countryCode: p.country });
  const json = await googleFetch<unknown>("search", "/v1/places:searchText", { body, mask: MASK_SEARCH_PRO, signal: opts.signal, retry: opts.retry === true });
  return parseSearch(json).places;
}

/** "Match manually": the ≤ 5 candidates of one Text Search Pro (transient — shown inside the open Google section only). Throws GoogleError. */
export async function findCandidates(p: CheckProspect, opts: { signal?: AbortSignal } = {}): Promise<GoogleCandidate[]> {
  const places = await searchForProspect(p, { signal: opts.signal, retry: false });
  return candidatesOf(places, { lat: p.lat, lng: p.lng });
}

/** The save-time match: one Text Search Pro, the prospect as the row (name key, 300 m with coordinates, else the postcode). Throws GoogleError. */
export async function matchProspect(p: CheckProspect, opts: { signal?: AbortSignal; retry?: boolean } = {}): Promise<{ hit: string | null }> {
  const places = await searchForProspect(p, opts);
  const row = { key: `prospect:${p.id}`, name: p.name, lat: p.lat ?? undefined, lng: p.lng ?? undefined, geoSource: hasPoint(p) ? ("source" as const) : ("none" as const), postcode: p.postcode };
  for (const place of places) {
    if (matchPlace(place, [row], { maxM: PROSPECT_MATCH_MAX_M, stripWords: stripWordsFor(p) })) return { hit: place.placeId };
  }
  return { hit: null };
}

/**
 * The check for one prospect: decide, request what the decision needs, and
 * return the checks input plus the column writes (applied here when `apply`).
 * Never throws because of Google — a failed request leaves the listing
 * unmeasured with a reason.
 */
export async function googleCheck(p: CheckProspect, opts: CheckOptions = {}): Promise<GoogleCheckOutcome> {
  const now = opts.now ?? new Date();
  const on = googlePlacesOn();
  const prospect = { placeId: p.googlePlaceId, listing: p.googleListing, match: p.googleMatch, checkedAt: p.googleCheckedAt, hasLocation: hasPoint(p) || !!p.postcode };
  const latest = on && p.googlePlaceId ? googleSignals(p.id) : null;
  const decision = decide({ on, prospect, latestSignals: latest ? { fetchedAt: latest.fetchedAt } : null, now, fresh: opts.fresh });
  let columns: ColumnWrites = {};
  let signals: GoogleSignals | null = null;
  let hit: string | null = null;
  let error: GoogleErrorCode | undefined;
  let errorPool: GooglePool | undefined;
  let requested = false;
  const request = { signal: opts.signal, retry: opts.retry === true };
  const failed = (e: unknown) => {
    error = codeOf(e);
    if (e instanceof GoogleError && e.pool) errorPool = e.pool;
  };
  if (decision === "reuse") {
    signals = latest;
  } else if (decision === "signals") {
    requested = true;
    try {
      signals = await fetchSignals(p.googlePlaceId!, request);
    } catch (e) {
      failed(e);
    }
  } else if (decision === "match") {
    requested = true;
    try {
      // The match needs a Pro search and then an Enterprise read of the hit: with the details
      // pool spent, fail on that pool now rather than after a search whose hit cannot be read.
      if (!googleAllowance("google_details_enterprise")) throw new GoogleError("allowance", "google_details_enterprise");
      ({ hit } = await matchProspect(p, request));
      columns = applyMatch({ hit, now }).columns;
      if (hit) {
        try {
          signals = await fetchSignals(hit, request);
        } catch (e) {
          failed(e);
        }
      }
    } catch (e) {
      failed(e);
    }
  }
  const google = checkInputFor(decision, prospect, { signals, hit, error });
  if (opts.apply !== false && Object.keys(columns).length > 0) updateGoogleColumns(p.id, columns);
  const out: GoogleCheckOutcome = { decision, google, columns, signals, requested };
  if (error) out.error = error;
  if (errorPool) out.errorPool = errorPool;
  return out;
}

/**
 * "Check again" on the prospect page (§4.5): write a fresh check into the
 * latest finished audit — its google_listing row, score, grade, flags, fits
 * and top, and the prospect's latest_score / latest_grade — so the page and
 * the report read the new state without a new audit. Null when the prospect
 * has no finished audit yet (the caller queues one).
 */
export function storeCheckResult(prospectId: number, google: GoogleCheckInput): number | null {
  const db = enquiriesDb();
  const row = db
    .prepare("SELECT a.id, a.checks, a.flags, a.fits FROM prospects p JOIN audits a ON a.id = p.latest_audit_id WHERE p.id = ? AND a.status = 'done'")
    .get(prospectId) as { id: number; checks: string | null; flags: string; fits: string } | undefined;
  if (!row) return null;
  const checks = parseJson<AuditChecks | null>(row.checks, null);
  if (!checks || typeof checks !== "object") return null;
  checks.google_listing = googleListing(google);
  const flags = parseJson<Flag[]>(row.flags, []);
  const fits = parseJson<FitSuggestion[]>(row.fits, []);
  const score = auditScore(checks, { ecommerce: fits.some((f) => f.pkg === "SEC"), forbidsExtraction: flags.includes("forbids-extraction") });
  const now = sqlNow();
  db.transaction(() => {
    db.prepare("UPDATE audits SET checks = ?, score = ?, grade = ?, flags = ?, fits = ?, top = ? WHERE id = ?").run(
      JSON.stringify(checks),
      score.score,
      score.grade,
      JSON.stringify(score.flags),
      JSON.stringify(score.fits),
      JSON.stringify(score.top),
      row.id,
    );
    db.prepare("UPDATE prospects SET latest_score = ?, latest_grade = ?, updated_at = ? WHERE id = ?").run(score.score, score.grade, now, prospectId);
  })();
  return row.id;
}
