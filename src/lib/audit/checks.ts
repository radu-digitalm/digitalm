// The ten checks (contract §7.2) from a crawl, a PageSpeed summary and the
// extraction — pure: no I/O, relative imports, so the whole pipeline can run
// outside Next. Each CheckResult carries scalar `details` (the keys score.ts
// reads for flags are named there: certDaysLeft, timedOut, viewport, channel,
// booking, llmsTxt, chat, stale, mixedContent).
import type { AuditChecks, CheckResult, CheckStatus, GoogleListingReason, GoogleSignals, PsiSummary } from "../crm/types.ts";
import type { Extraction } from "./extract.ts";
import type { SiteCrawl } from "./crawler.ts";
import { SLOW_MS } from "./crawler.ts";
import { CHECK_WEIGHTS } from "../crm/types.ts";
import { makeCheck } from "./score.ts";

/** The Google-listing input (finder-google §4.6): the stored state, the derived signals of one Place Details answer, and why they are missing. */
export interface GoogleListingInput {
  status: "unverified" | "found" | "not_found";
  signals: GoogleSignals | null;
  reason?: GoogleListingReason;
  checkedAt?: string | null;
}

export interface ChecksInput {
  site: SiteCrawl | null;
  psi: PsiSummary | null;
  extraction: Extraction | null;
  google: GoogleListingInput;
  now?: Date;
}

const CERT_MIN_DAYS = 30;

function shortUrl(u: string | null | undefined): string | null {
  return u ? u.slice(0, 500) : null;
}

function reachable(site: SiteCrawl | null): CheckResult {
  if (!site) return makeCheck("reachable", "fail", { error: "no_website" });
  if (site.homeBlockedByRobots) return makeCheck("reachable", "not_measured", { error: "robots_disallow", finalUrl: shortUrl(site.finalUrl) });
  const details: CheckResult["details"] = { status: site.homeStatus, ms: site.homeMs, finalUrl: shortUrl(site.finalUrl), error: site.homeError, truncated: site.homeTruncated };
  if (site.homeError || !site.home) return makeCheck("reachable", "fail", details);
  if (site.homeStatus < 200 || site.homeStatus >= 300) return makeCheck("reachable", "fail", details);
  return makeCheck("reachable", site.homeMs > SLOW_MS ? "partial" : "pass", details);
}

function https(site: SiteCrawl | null): CheckResult {
  const tls = site?.tls ?? null;
  if (!site || !tls) return makeCheck("https", "not_measured", {});
  const details: CheckResult["details"] = {
    https: site.httpsFinal,
    tlsOk: tls.ok,
    authorized: tls.authorized,
    tlsError: tls.error,
    certDaysLeft: tls.daysLeft,
    validTo: tls.validTo,
    issuer: tls.issuer,
    protocol: tls.protocol,
    redirect: site.httpToHttpsRedirect,
    hsts: site.hsts,
  };
  if (!tls.ok || !tls.authorized) return makeCheck("https", "fail", details);
  const certOk = tls.daysLeft !== null && tls.daysLeft > CERT_MIN_DAYS;
  const status: CheckStatus = site.httpsFinal && site.httpToHttpsRedirect === true && site.hsts === true && certOk ? "pass" : "partial";
  return makeCheck("https", status, details);
}

function speed(site: SiteCrawl | null, psi: PsiSummary | null, siteUp: boolean): CheckResult {
  const perf = psi?.performance ?? null;
  const details: CheckResult["details"] = { performance: perf, lcpMs: psi?.lcpMs ?? null, cls: psi?.cls ?? null, timedOut: psi ? psi.timedOut || perf === null : true, fetchedAt: psi?.fetchedAt ?? null };
  if (perf === null) {
    // No score: our timeout or PSI's own error. Amber when the site answers us, else nothing to measure.
    return makeCheck("speed", siteUp && site ? "partial" : "not_measured", details);
  }
  return makeCheck("speed", perf >= 0.7 ? "pass" : perf >= 0.4 ? "partial" : "fail", details);
}

function seoBasics(site: SiteCrawl | null, psi: PsiSummary | null, extraction: Extraction | null, siteUp: boolean): CheckResult {
  const seo = psi?.seo ?? null;
  const fromHtml = !!site?.home && !!extraction && site.home.text.length > 0;
  const viewport = psi?.viewport ?? (fromHtml ? extraction!.hasViewport : null);
  const title = psi?.title ?? (fromHtml ? extraction!.title !== null : null);
  const description = psi?.description ?? (fromHtml ? extraction!.description !== null : null);
  const details: CheckResult["details"] = { seo, viewport, title, description, psiTimedOut: psi ? psi.timedOut : true };
  if (seo === null && viewport === null) return makeCheck("seo_basics", "not_measured", details);
  if (viewport === false || (seo !== null && seo < 0.7)) return makeCheck("seo_basics", "fail", details);
  if (seo !== null && seo >= 0.9 && viewport === true && title === true && description === true) return makeCheck("seo_basics", "pass", details);
  return makeCheck("seo_basics", siteUp || seo !== null ? "partial" : "not_measured", details);
}

function contact(extraction: Extraction | null, hasHtml: boolean): CheckResult {
  if (!extraction || !hasHtml) return makeCheck("contact", "not_measured", {});
  const channel = extraction.hasTel || extraction.hasMailto || extraction.hasEmailForm;
  const booking = extraction.booking !== null;
  const details: CheckResult["details"] = { channel, tel: extraction.hasTel, mailto: extraction.hasMailto, form: extraction.hasEmailForm, booking, bookingProvider: extraction.booking, pages: extraction.pagesScanned };
  if (channel && booking) return makeCheck("contact", "pass", details);
  if (channel || booking) return makeCheck("contact", "partial", details);
  return makeCheck("contact", "fail", details);
}

function socials(extraction: Extraction | null, hasHtml: boolean): CheckResult {
  if (!extraction || !hasHtml) return makeCheck("socials", "not_measured", {});
  const networks = Object.keys(extraction.socials);
  return makeCheck("socials", networks.length > 0 ? "pass" : "fail", { count: networks.length, networks: networks.join(",") });
}

function schema(extraction: Extraction | null, hasHtml: boolean): CheckResult {
  if (!extraction || !hasHtml) return makeCheck("schema", "not_measured", {});
  const j = extraction.jsonLd;
  const details: CheckResult["details"] = { jsonLd: j.present, type: j.type, localBusiness: j.localBusiness, telephone: j.telephone, openingHours: j.openingHours };
  if (j.localBusiness && j.telephone && j.openingHours) return makeCheck("schema", "pass", details);
  if (j.present) return makeCheck("schema", "partial", details);
  return makeCheck("schema", "fail", details);
}

function aiReady(site: SiteCrawl | null, extraction: Extraction | null): CheckResult {
  const bots = site?.aiBots ?? null;
  const chat = extraction?.chat ?? null;
  const details: CheckResult["details"] = {
    robotsStatus: site?.robotsStatus ?? null,
    gptbot: bots?.gptbot ?? null,
    claudebot: bots?.claudebot ?? null,
    perplexitybot: bots?.perplexitybot ?? null,
    googleExtended: bots?.googleExtended ?? null,
    llmsTxt: site?.llmsTxt ?? false,
    chat: chat !== null,
    chatProvider: chat,
  };
  if (!site || !bots) return makeCheck("ai_ready", "not_measured", details);
  const blocked = Object.values(bots).some((allowed) => !allowed);
  if (blocked) return makeCheck("ai_ready", "fail", details);
  if (site.llmsTxt || chat !== null) return makeCheck("ai_ready", "pass", details);
  return makeCheck("ai_ready", "partial", details);
}

/** Points of a found listing (finder-google §4.6): 4 exists + 1 open + 2 website on the listing + 1 hours + 1 reviews ≥ 5 + 1 photos ≥ 1. */
export function listingPoints(s: GoogleSignals): number {
  return 4 + (s.operational === true ? 1 : 0) + (s.websiteOnListing ? 2 : 0) + (s.hours ? 1 : 0) + (s.reviews >= 5 ? 1 : 0) + (s.photos >= 1 ? 1 : 0);
}

/**
 * The Google-listing check. `unverified` and a found listing without signals
 * are not measured (the details say why); `not_found` — set by Radu only —
 * fails; a found listing with signals scores its points (pass ≥ 9, else
 * partial). The details hold our derived booleans and counts and the joined
 * attribution provider names — never a string from the listing.
 */
export function googleListing(google: GoogleListingInput): CheckResult {
  const { status, signals } = google;
  if (status === "not_found") return makeCheck("google_listing", "fail", { listing: "not_found", checkedAt: google.checkedAt ?? null });
  if (status !== "found") {
    const details: CheckResult["details"] = { listing: "unverified" };
    if (google.reason) details.reason = google.reason;
    if (google.checkedAt) details.checkedAt = google.checkedAt;
    return makeCheck("google_listing", "not_measured", details);
  }
  if (!signals) return makeCheck("google_listing", "not_measured", { listing: "found", reason: google.reason ?? "unavailable" });
  const points = Math.min(CHECK_WEIGHTS.google_listing, listingPoints(signals));
  const details: CheckResult["details"] = {
    listing: "found",
    operational: signals.operational,
    websiteOnListing: signals.websiteOnListing,
    hours: signals.hours,
    reviews: signals.reviews,
    photos: signals.photos,
    fetchedAt: signals.fetchedAt,
    attributions: signals.attributions.join(" · "),
  };
  return makeCheck("google_listing", points >= 9 ? "pass" : "partial", details, points);
}

function housekeeping(site: SiteCrawl | null, extraction: Extraction | null, hasHtml: boolean, now: Date): CheckResult {
  if (!site || !extraction || !hasHtml) return makeCheck("housekeeping", "not_measured", {});
  const year = extraction.copyrightYear;
  const stale = year !== null && year < now.getUTCFullYear() - 1;
  const mixed = site.httpsFinal && extraction.mixedContent > 0;
  const details: CheckResult["details"] = { copyrightYear: year, stale, legalLink: extraction.legalLink, mixedContent: mixed, mixedCount: extraction.mixedContent, cms: extraction.cms, cookieBanner: extraction.cookieBanner };
  const misses = (stale ? 1 : 0) + (extraction.legalLink ? 0 : 1) + (mixed ? 1 : 0);
  return makeCheck("housekeeping", misses === 0 ? "pass" : misses === 1 ? "partial" : "fail", details);
}

/** All ten checks; `site: null` means no website (everything not_measured but reachable). */
export function runChecks(input: ChecksInput): AuditChecks {
  const { site, psi, extraction } = input;
  const now = input.now ?? new Date();
  const r = reachable(site);
  const siteUp = r.status === "pass" || r.status === "partial";
  const hasHtml = !!site?.home && site.home.text.length > 0 && siteUp;
  return {
    reachable: r,
    https: https(site),
    speed: speed(site, psi, siteUp),
    seo_basics: seoBasics(site, psi, extraction, siteUp),
    contact: contact(extraction, hasHtml),
    socials: socials(extraction, hasHtml),
    schema: schema(extraction, hasHtml),
    ai_ready: aiReady(site, extraction),
    google_listing: googleListing(input.google),
    housekeeping: housekeeping(site, extraction, hasHtml, now),
  };
}
