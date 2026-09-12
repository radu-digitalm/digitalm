import { test } from "node:test";
import assert from "node:assert/strict";
import { googleListing, listingPoints, runChecks } from "./checks.ts";
import type { GoogleSignals } from "../crm/types.ts";
import type { SiteCrawl } from "./crawler.ts";
import type { TlsInfo } from "./tls.ts";
import type { Extraction } from "./extract.ts";
import type { CrawledPage, PsiSummary } from "../crm/types.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

const page = (url: string, text = "<html><body>ok</body></html>"): CrawledPage => ({ url, finalUrl: url, status: 200, contentType: "text/html", headers: {}, text, fetchedAt: NOW.toISOString() });

function tls(over: Partial<TlsInfo> = {}): TlsInfo {
  return { ok: true, authorized: true, error: null, validTo: "2027-01-01T00:00:00.000Z", daysLeft: 112, protocol: "TLSv1.3", issuer: "R3", ms: 80, ...over };
}

function site(over: Partial<SiteCrawl> = {}): SiteCrawl {
  const home = page("https://www.example.fr/");
  return {
    website: "https://www.example.fr/",
    hostname: "www.example.fr",
    origin: "https://www.example.fr",
    finalUrl: "https://www.example.fr/",
    home,
    homeStatus: 200,
    homeError: null,
    homeMs: 800,
    homeTruncated: false,
    homeBlockedByRobots: false,
    httpsFinal: true,
    httpToHttpsRedirect: true,
    hsts: true,
    tls: tls(),
    pages: [home],
    contact: null,
    legal: null,
    robots: { groups: [] },
    robotsStatus: 404,
    aiBots: { gptbot: true, claudebot: true, perplexitybot: true, googleExtended: true },
    llmsTxt: false,
    skipped: [],
    crawl: [{ url: "https://www.example.fr/", status: 200, bytes: 1234 }],
    ...over,
  };
}

function psi(over: Partial<PsiSummary> = {}): PsiSummary {
  return { performance: 0.85, seo: 0.95, lcpMs: 1800, cls: 0.02, viewport: true, title: true, description: true, fetchedAt: NOW.toISOString(), timedOut: false, ...over };
}

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    title: "Le Fournil",
    description: "Boulangerie à Foix",
    hasViewport: true,
    email: "contact@example.fr",
    emailPage: "https://www.example.fr/contact",
    phone: "+33561000000",
    socials: { facebook: "https://www.facebook.com/lefournil" },
    cms: "WordPress",
    ecommerce: false,
    hasTel: true,
    hasMailto: true,
    hasEmailForm: false,
    booking: "site",
    chat: "whatsapp",
    jsonLd: { present: true, type: "Bakery", localBusiness: true, telephone: true, openingHours: true },
    cookieBanner: true,
    mixedContent: 0,
    copyrightYear: 2026,
    legalLink: true,
    forbidsExtraction: false,
    pagesScanned: 1,
    ...over,
  };
}

const all = (s: SiteCrawl | null, p: PsiSummary | null, x: Extraction | null, listing: "unverified" | "found" | "not_found" = "unverified", signals: GoogleSignals | null = null) =>
  runChecks({ site: s, psi: p, extraction: x, google: { status: listing, signals }, now: NOW });

function signals(over: Partial<GoogleSignals> = {}): GoogleSignals {
  return { operational: true, websiteOnListing: true, hours: true, reviews: 37, photos: 3, fetchedAt: NOW.toISOString(), attributions: [], ...over };
}

test("a healthy site passes every measured check; google_listing stays unmeasured until confirmed", () => {
  const c = all(site(), psi(), extraction());
  for (const key of ["reachable", "https", "speed", "seo_basics", "contact", "socials", "schema", "housekeeping"] as const) {
    assert.equal(c[key].status, "pass", key);
    assert.equal(c[key].measured, true, key);
  }
  assert.equal(c.ai_ready.status, "pass"); // bots allowed + chat
  assert.equal(c.google_listing.status, "not_measured");
  assert.equal(c.google_listing.measured, false);
  // A found listing without its signals (allowance used up, Google silent) is still not measured.
  assert.equal(all(site(), psi(), extraction(), "found").google_listing.status, "not_measured");
  assert.equal(all(site(), psi(), extraction(), "found", signals()).google_listing.status, "pass");
  assert.equal(all(site(), psi(), extraction(), "not_found").google_listing.status, "fail");
});

test("google_listing (finder-google §4.6): points from the derived signals, status words in details, attributions as one string", () => {
  const maintained = googleListing({ status: "found", signals: signals() });
  assert.equal(maintained.status, "pass");
  assert.equal(maintained.points, 10);
  assert.equal(maintained.measured, true);
  assert.deepEqual(Object.keys(maintained.details).sort(), ["attributions", "fetchedAt", "hours", "listing", "operational", "photos", "reviews", "websiteOnListing"]);
  assert.equal(maintained.details.attributions, "");
  assert.equal(listingPoints(signals()), 10);
  // The unmaintained fixture: open, no website, no hours, 2 reviews, no photo → 5 points, partial.
  const unmaintained = googleListing({ status: "found", signals: signals({ websiteOnListing: false, hours: false, reviews: 2, photos: 0, attributions: ["Example Data Co"] }) });
  assert.equal(unmaintained.status, "partial");
  assert.equal(unmaintained.points, 5);
  assert.equal(unmaintained.details.attributions, "Example Data Co");
  // Closed permanently with everything else in place → 9 → pass minus the open point → 9 still passes; closed with no photos → 8 partial keeps 8.
  assert.equal(googleListing({ status: "found", signals: signals({ operational: false }) }).points, 9);
  const eight = googleListing({ status: "found", signals: signals({ operational: false, photos: 0 }) });
  assert.equal(eight.status, "partial");
  assert.equal(eight.points, 8);
  assert.equal(googleListing({ status: "found", signals: signals({ operational: null, websiteOnListing: false, hours: false, reviews: 4, photos: 0 }) }).points, 4);
  // Not measured cases carry the reason; not_found (manual only) fails with 0.
  const noMatch = googleListing({ status: "unverified", signals: null, reason: "no_match", checkedAt: "2026-09-12 10:00:00" });
  assert.equal(noMatch.status, "not_measured");
  assert.deepEqual(noMatch.details, { listing: "unverified", reason: "no_match", checkedAt: "2026-09-12 10:00:00" });
  assert.deepEqual(googleListing({ status: "unverified", signals: null }).details, { listing: "unverified" });
  assert.deepEqual(googleListing({ status: "found", signals: null, reason: "allowance" }).details, { listing: "found", reason: "allowance" });
  assert.deepEqual(googleListing({ status: "found", signals: null }).details, { listing: "found", reason: "unavailable" });
  const rejected = googleListing({ status: "not_found", signals: null, checkedAt: "2026-09-12 10:00:00" });
  assert.equal(rejected.status, "fail");
  assert.equal(rejected.points, 0);
  assert.deepEqual(rejected.details, { listing: "not_found", checkedAt: "2026-09-12 10:00:00" });
  // Every detail is a primitive (CheckResult.details holds scalars only).
  for (const r of [maintained, unmaintained, noMatch, rejected]) for (const v of Object.values(r.details)) assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v));
});

test("no website: reachable fails, everything else is not measured", () => {
  const c = all(null, null, null);
  assert.equal(c.reachable.status, "fail");
  assert.equal(c.reachable.details.error, "no_website");
  for (const key of ["https", "speed", "seo_basics", "contact", "socials", "schema", "ai_ready", "housekeeping", "google_listing"] as const) {
    assert.equal(c[key].status, "not_measured", key);
  }
});

test("reachable: final 2xx passes, > 5 s is partial, errors / 4xx / 5xx fail, robots disallow is not measured", () => {
  assert.equal(all(site({ homeMs: 5001 }), psi(), extraction()).reachable.status, "partial");
  assert.equal(all(site({ homeStatus: 503 }), psi(), extraction()).reachable.status, "fail");
  assert.equal(all(site({ homeStatus: 404 }), psi(), extraction()).reachable.status, "fail");
  assert.equal(all(site({ home: null, homeStatus: 0, homeError: "timeout" }), psi(), extraction()).reachable.status, "fail");
  const blocked = all(site({ homeBlockedByRobots: true, home: null, homeStatus: 0 }), psi(), extraction()).reachable;
  assert.equal(blocked.status, "not_measured");
  assert.equal(blocked.details.error, "robots_disallow");
});

test("https: valid cert > 30 d + redirect + HSTS passes; a missing piece or a short cert is partial; no TLS fails", () => {
  assert.equal(all(site({ hsts: false }), psi(), extraction()).https.status, "partial");
  assert.equal(all(site({ httpToHttpsRedirect: false }), psi(), extraction()).https.status, "partial");
  assert.equal(all(site({ tls: tls({ daysLeft: 12 }) }), psi(), extraction()).https.status, "partial");
  assert.equal(all(site({ tls: tls({ daysLeft: 30 }) }), psi(), extraction()).https.status, "partial");
  assert.equal(all(site({ tls: tls({ ok: false, authorized: false, error: "ECONNREFUSED" }) }), psi(), extraction()).https.status, "fail");
  assert.equal(all(site({ tls: tls({ authorized: false, error: "CERT_HAS_EXPIRED" }) }), psi(), extraction()).https.status, "fail");
  assert.equal(all(site({ tls: null }), psi(), extraction()).https.status, "not_measured");
  assert.equal(all(site(), psi(), extraction()).https.details.certDaysLeft, 112);
});

test("speed: PSI thresholds 0.70 / 0.40; a timeout is partial while the site answers, else not measured", () => {
  assert.equal(all(site(), psi({ performance: 0.7 }), extraction()).speed.status, "pass");
  assert.equal(all(site(), psi({ performance: 0.69 }), extraction()).speed.status, "partial");
  assert.equal(all(site(), psi({ performance: 0.4 }), extraction()).speed.status, "partial");
  assert.equal(all(site(), psi({ performance: 0.39 }), extraction()).speed.status, "fail");
  const timedOut = all(site(), psi({ performance: null, timedOut: true }), extraction()).speed;
  assert.equal(timedOut.status, "partial");
  assert.equal(timedOut.measured, true);
  assert.equal(timedOut.details.timedOut, true);
  assert.equal(all(site({ homeStatus: 500 }), psi({ performance: null, timedOut: true }), extraction()).speed.status, "not_measured");
});

test("seo_basics: SEO ≥ 0.90 + viewport + title + description passes; one miss or 0.70–0.89 partial; no viewport or < 0.70 fails", () => {
  assert.equal(all(site(), psi({ seo: 0.9 }), extraction()).seo_basics.status, "pass");
  assert.equal(all(site(), psi({ seo: 0.85 }), extraction()).seo_basics.status, "partial");
  assert.equal(all(site(), psi({ description: false }), extraction()).seo_basics.status, "partial");
  assert.equal(all(site(), psi({ viewport: false }), extraction()).seo_basics.status, "fail");
  assert.equal(all(site(), psi({ seo: 0.69 }), extraction()).seo_basics.status, "fail");
  // PSI silent: the HTML tells us about viewport/title/description; no SEO score → partial at best.
  const fromHtml = all(site(), psi({ seo: null, viewport: null, title: null, description: null, performance: null, timedOut: true }), extraction()).seo_basics;
  assert.equal(fromHtml.status, "partial");
  assert.equal(fromHtml.details.viewport, true);
  assert.equal(all(site(), psi({ seo: null, viewport: null, title: null, description: null, performance: null, timedOut: true }), extraction({ hasViewport: false })).seo_basics.status, "fail");
});

test("contact: a channel AND a booking passes; one of them partial; neither fails", () => {
  assert.equal(all(site(), psi(), extraction({ hasTel: false, hasMailto: false, hasEmailForm: true })).contact.status, "pass");
  assert.equal(all(site(), psi(), extraction({ booking: null })).contact.status, "partial");
  assert.equal(all(site(), psi(), extraction({ hasTel: false, hasMailto: false, hasEmailForm: false })).contact.status, "partial");
  assert.equal(all(site(), psi(), extraction({ hasTel: false, hasMailto: false, hasEmailForm: false, booking: null })).contact.status, "fail");
});

test("socials / schema", () => {
  assert.equal(all(site(), psi(), extraction({ socials: {} })).socials.status, "fail");
  assert.equal(all(site(), psi(), extraction()).socials.details.networks, "facebook");
  assert.equal(all(site(), psi(), extraction({ jsonLd: { present: true, type: "Bakery", localBusiness: true, telephone: true, openingHours: false } })).schema.status, "partial");
  assert.equal(all(site(), psi(), extraction({ jsonLd: { present: true, type: null, localBusiness: false, telephone: false, openingHours: false } })).schema.status, "partial");
  assert.equal(all(site(), psi(), extraction({ jsonLd: { present: false, type: null, localBusiness: false, telephone: false, openingHours: false } })).schema.status, "fail");
});

test("ai_ready: any blocked bot fails; allowed + llms.txt or chat passes; allowed alone partial; no robots verdict not measured", () => {
  assert.equal(all(site({ aiBots: { gptbot: false, claudebot: true, perplexitybot: true, googleExtended: true } }), psi(), extraction()).ai_ready.status, "fail");
  assert.equal(all(site({ llmsTxt: true }), psi(), extraction({ chat: null })).ai_ready.status, "pass");
  assert.equal(all(site(), psi(), extraction({ chat: null })).ai_ready.status, "partial");
  assert.equal(all(site({ aiBots: null, robots: null, robotsStatus: null }), psi(), extraction()).ai_ready.status, "not_measured");
  assert.equal(all(site({ aiBots: { gptbot: true, claudebot: false, perplexitybot: true, googleExtended: true } }), psi(), extraction()).ai_ready.details.claudebot, false);
});

test("housekeeping: copyright ≥ current−1, a legal link and no mixed content pass; one miss partial; two fail", () => {
  assert.equal(all(site(), psi(), extraction({ copyrightYear: 2025 })).housekeeping.status, "pass");
  assert.equal(all(site(), psi(), extraction({ copyrightYear: 2024 })).housekeeping.status, "partial");
  assert.equal(all(site(), psi(), extraction({ copyrightYear: null, legalLink: true, mixedContent: 0 })).housekeeping.status, "pass"); // no year found is not stale
  assert.equal(all(site(), psi(), extraction({ legalLink: false, mixedContent: 2 })).housekeeping.status, "fail");
  // Mixed content only counts on an https final URL.
  assert.equal(all(site({ httpsFinal: false }), psi(), extraction({ mixedContent: 3 })).housekeeping.status, "pass");
  const details = all(site(), psi(), extraction({ mixedContent: 3 })).housekeeping.details;
  assert.equal(details.mixedContent, true);
  assert.equal(details.mixedCount, 3);
});

test("a home that is not HTML (or a 5xx) leaves the content checks unmeasured", () => {
  const down = all(site({ homeStatus: 500 }), psi(), extraction());
  for (const key of ["contact", "socials", "schema", "housekeeping"] as const) assert.equal(down[key].status, "not_measured", key);
  const empty = all(site({ home: page("https://www.example.fr/", ""), pages: [] }), psi(), extraction());
  assert.equal(empty.contact.status, "not_measured");
});
