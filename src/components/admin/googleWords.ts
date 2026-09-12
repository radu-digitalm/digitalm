// Words for the Google-listing check (docs/finder-google-spec.md §4.6, §5.6):
// pure functions from a check result or a prospect's Google fields to the
// status word, the signal words and the §4.6 points. Status words are our
// audit result and may appear anywhere (AuditBlock, the section summary);
// signal words are rendered only inside the open Google section (§3.4).
// No React, no "use client" — node --test drives it (googleWords.test.ts).
import type { CheckResult } from "../../lib/crm/types.ts";
import type { GoogleListingReason, GoogleSignals } from "./finderApi.ts";
import { formatInt } from "./format.ts";
import { GOOGLE_TEXT, fill } from "./wording.ts";

export type GoogleStatus = "maintained" | "unmaintained" | "found_no_details" | "not_found" | "no_match" | "no_location" | "not_checked";

/** 4 exists + 1 operational + 2 website on the listing + 1 hours + 1 reviews ≥ 5 + 1 photos ≥ 1 (§4.6). */
export function googlePoints(s: GoogleSignals): number {
  return 4 + (s.operational === true ? 1 : 0) + (s.websiteOnListing ? 2 : 0) + (s.hours ? 1 : 0) + (s.reviews >= 5 ? 1 : 0) + (s.photos >= 1 ? 1 : 0);
}

/** pass ≥ 9, partial 4–8 (the check exists only when the listing was found). */
export function googleCheckStatus(s: GoogleSignals): "pass" | "partial" {
  return googlePoints(s) >= 9 ? "pass" : "partial";
}

function reasonOf(v: unknown): GoogleListingReason | null {
  return v === "no_match" || v === "no_location" || v === "allowance" || v === "unavailable" ? v : null;
}

/** From an audit's `google_listing` check: status words only, never a signal. */
export function googleStatusFromCheck(c: Pick<CheckResult, "status" | "details">): { status: GoogleStatus; reason: GoogleListingReason | null } {
  const listing = c.details.listing;
  const reason = reasonOf(c.details.reason);
  if (listing === "found") {
    if (c.status === "pass") return { status: "maintained", reason: null };
    if (c.status === "partial") return { status: "unmaintained", reason: null };
    return { status: "found_no_details", reason };
  }
  if (listing === "not_found") return { status: "not_found", reason: null };
  if (reason === "no_match") return { status: "no_match", reason };
  if (reason === "no_location") return { status: "no_location", reason };
  return { status: "not_checked", reason };
}

export type GoogleProspectFields = {
  googleListing: "unverified" | "found" | "not_found";
  googleSignals?: GoogleSignals | null;
  googleMatch?: "auto" | "manual" | null;
  googleCheckedAt?: string | null;
  lat: number | null;
  lng: number | null;
  postcode: string | null;
};

/** From the prospect's own fields (the page and the `/google` route answers). */
export function googleStatusOfProspect(p: GoogleProspectFields, reason: GoogleListingReason | null = null): GoogleStatus {
  if (p.googleListing === "found") {
    if (p.googleSignals) return googleCheckStatus(p.googleSignals) === "pass" ? "maintained" : "unmaintained";
    return "found_no_details";
  }
  if (p.googleListing === "not_found") return "not_found";
  if (reason === "no_location") return "no_location";
  if (reason === "no_match") return "no_match";
  const hasLocation = (p.lat !== null && p.lng !== null) || !!p.postcode;
  if (p.googleMatch === "auto" && p.googleCheckedAt) return "no_match";
  if (!hasLocation && p.googleMatch !== "manual") return "no_location";
  return "not_checked";
}

/** The status word (§5.6); `short` for the audit block's fact line and the section summary. */
export function googleStatusWord(s: GoogleStatus, short = false): string {
  switch (s) {
    case "maintained":
      return GOOGLE_TEXT.statusMaintained;
    case "unmaintained":
      return GOOGLE_TEXT.statusUnmaintained;
    case "found_no_details":
      return GOOGLE_TEXT.statusFoundNoDetails;
    case "not_found":
      return GOOGLE_TEXT.statusNotFound;
    case "no_match":
      return short ? GOOGLE_TEXT.statusNoMatchShort : GOOGLE_TEXT.statusNoMatch;
    case "no_location":
      return GOOGLE_TEXT.statusNoLocation;
    default:
      return GOOGLE_TEXT.statusNotChecked;
  }
}

/** Why the details were not checked, in words; null for the reasons that are already the status. */
export function googleReasonWord(reason: GoogleListingReason | null | undefined): string | null {
  if (reason === "allowance") return GOOGLE_TEXT.reasonAllowance;
  if (reason === "unavailable") return GOOGLE_TEXT.reasonUnavailable;
  return null;
}

export type GoogleTone = "good" | "warn" | "bad" | "neutral";

export function googleStatusTone(s: GoogleStatus): GoogleTone {
  if (s === "maintained") return "good";
  if (s === "unmaintained") return "warn";
  if (s === "not_found") return "bad";
  return "neutral";
}

/** The five signals as words — only for the open Google section of the prospect page. */
export function googleSignalWords(s: GoogleSignals): string[] {
  const out: string[] = [];
  if (s.operational === true) out.push(GOOGLE_TEXT.signalOpen);
  else if (s.operational === false) out.push(GOOGLE_TEXT.signalClosed);
  out.push(s.websiteOnListing ? GOOGLE_TEXT.signalWebsite : GOOGLE_TEXT.signalNoWebsite);
  out.push(s.hours ? GOOGLE_TEXT.signalHours : GOOGLE_TEXT.signalNoHours);
  out.push(s.reviews === 1 ? GOOGLE_TEXT.signalReviewOne : fill(GOOGLE_TEXT.signalReviews, { n: formatInt(s.reviews) }));
  out.push(s.photos === 1 ? GOOGLE_TEXT.signalPhotoOne : fill(GOOGLE_TEXT.signalPhotos, { n: formatInt(s.photos) }));
  return out;
}

/** Whole days since the signals were fetched; null without a usable date. */
export function googleSignalAgeDays(fetchedAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!fetchedAt) return null;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Signals older than 30 days are refreshed by the next audit; the page says so. */
export const GOOGLE_SIGNALS_MAX_AGE_DAYS = 30;

/** "Data: Example Data Co · Other Co" from the stored provider names; "" when none. */
export function googleDataLine(attributions: readonly string[] | null | undefined): string {
  const names = (attributions ?? []).map((a) => a.trim()).filter(Boolean);
  return names.length ? fill(GOOGLE_TEXT.dataFrom, { names: names.join(" · ") }) : "";
}

/** "Le Phoebus — 12 rue de la Gare · 40 m" for a manual-match candidate (strings capped at 200 chars, §7). */
export function googleCandidateLine(c: { name: string; addressLine: string; distanceM: number | null }): string {
  const name = c.name.trim().slice(0, 200);
  const address = c.addressLine.trim().slice(0, 200);
  const distance = c.distanceM !== null && Number.isFinite(c.distanceM) ? formatInt(Math.round(c.distanceM)) : "";
  if (address && distance) return fill(GOOGLE_TEXT.candidate, { name, address, distance });
  if (address) return fill(GOOGLE_TEXT.candidateNoDistance, { name, address });
  return distance ? `${name} · ${distance} m` : name;
}
