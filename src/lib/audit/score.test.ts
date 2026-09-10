import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_WEIGHTS } from "../crm/types.ts";
import type { AuditChecks, CheckKey, CheckResult, CheckStatus } from "../crm/types.ts";
import { CHECK_ORDER, auditScore, fitsFor, flagsFor, gradeFor, makeCheck, noSiteChecks, pointsFor, topChecks } from "./score.ts";

type Overrides = Partial<Record<CheckKey, { status: CheckStatus; details?: CheckResult["details"] }>>;

/** Every check passing, with per-key overrides. */
function fixture(overrides: Overrides = {}): AuditChecks {
  const out = {} as AuditChecks;
  for (const key of CHECK_ORDER) {
    const o = overrides[key];
    out[key] = makeCheck(key, o?.status ?? "pass", o?.details ?? {});
  }
  return out;
}

test("weights sum to 100 and the order covers the ten keys", () => {
  assert.equal(Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(CHECK_ORDER.length, 10);
  assert.deepEqual([...CHECK_ORDER].sort(), Object.keys(CHECK_WEIGHTS).sort());
});

test("pointsFor: pass = weight, partial = round(weight/2), fail and not_measured = 0", () => {
  assert.equal(pointsFor("speed", "pass"), 15);
  assert.equal(pointsFor("speed", "partial"), 8);
  assert.equal(pointsFor("socials", "partial"), 3);
  assert.equal(pointsFor("housekeeping", "partial"), 3);
  assert.equal(pointsFor("https", "partial"), 5);
  assert.equal(pointsFor("https", "fail"), 0);
  assert.equal(pointsFor("https", "not_measured"), 0);
  assert.equal(makeCheck("ai_ready", "not_measured").measured, false);
  assert.equal(makeCheck("ai_ready", "fail").measured, true);
});

test("gradeFor thresholds", () => {
  assert.equal(gradeFor(100), "A");
  assert.equal(gradeFor(75), "A");
  assert.equal(gradeFor(74), "B");
  assert.equal(gradeFor(50), "B");
  assert.equal(gradeFor(49), "C");
  assert.equal(gradeFor(0), "C");
});

test("all pass = 100, grade A, no flags, no fits, empty top", () => {
  const s = auditScore(fixture());
  assert.equal(s.score, 100);
  assert.equal(s.grade, "A");
  assert.equal(s.earned, 100);
  assert.equal(s.measured, 100);
  assert.deepEqual(s.flags, []);
  assert.deepEqual(s.fits, []);
  assert.deepEqual(s.top, []);
});

test("PSI timeout counts as partial, measured, and does not flag slow-mobile", () => {
  const s = auditScore(fixture({ speed: { status: "partial", details: { timedOut: true, performance: null } } }));
  assert.equal(s.measured, 100);
  assert.equal(s.earned, 93);
  assert.equal(s.score, 93);
  assert.deepEqual(s.flags, []);
  assert.deepEqual(s.top, ["speed"]);
  // A measured 0.55 is partial too, but that one is a real finding.
  const slow = auditScore(fixture({ speed: { status: "partial", details: { timedOut: false, performance: 0.55 } } }));
  assert.deepEqual(slow.flags, ["slow-mobile"]);
  assert.deepEqual(slow.fits, [{ pkg: "WEB", flags: ["slow-mobile"] }]);
});

test("not_measured leaves the denominator (google_listing unverified)", () => {
  const s = auditScore(fixture({ google_listing: { status: "not_measured" } }));
  assert.equal(s.measured, 90);
  assert.equal(s.earned, 90);
  assert.equal(s.score, 100);
  const half = auditScore(fixture({ google_listing: { status: "not_measured" }, ai_ready: { status: "fail" }, speed: { status: "fail" } }));
  assert.equal(half.measured, 90);
  assert.equal(half.earned, 60);
  assert.equal(half.score, 67);
  assert.equal(half.grade, "B");
});

test("no website → score 0, grade C, flags ['no-site'], fit WEB, top ['reachable']", () => {
  const checks = noSiteChecks();
  for (const key of CHECK_ORDER) assert.equal(checks[key].measured, key === "reachable", key);
  const s = auditScore(checks);
  assert.equal(s.score, 0);
  assert.equal(s.grade, "C");
  assert.equal(s.measured, 10);
  assert.equal(s.earned, 0);
  assert.deepEqual(s.flags, ["no-site"]);
  assert.deepEqual(s.fits, [{ pkg: "WEB", flags: ["no-site"] }]);
  assert.deepEqual(s.top, ["reachable"]);
});

test("brochure site without https → WEB carries no-ssl, no SEC; WooCommerce without https → SEC", () => {
  const checks = fixture({ https: { status: "fail" } });
  const brochure = auditScore(checks, { ecommerce: false });
  assert.deepEqual(brochure.flags, ["no-ssl"]);
  assert.deepEqual(brochure.fits, [{ pkg: "WEB", flags: ["no-ssl"] }]);
  const shop = auditScore(checks, { ecommerce: true });
  assert.deepEqual(shop.flags, ["no-ssl"]);
  assert.deepEqual(shop.fits, [{ pkg: "SEC", flags: ["no-ssl"] }]);
  // Mixed content and an expiring cert follow the same rule; WEB keeps the rest.
  const mixed = fixture({
    https: { status: "partial", details: { certDaysLeft: 12 } },
    housekeeping: { status: "partial", details: { mixedContent: true, stale: false } },
    socials: { status: "fail" },
  });
  const f = fitsFor(flagsFor(mixed), true);
  assert.deepEqual(f, [
    { pkg: "SEC", flags: ["cert-expiring", "mixed-content"] },
    { pkg: "WEB", flags: ["no-socials"] },
  ]);
  assert.deepEqual(fitsFor(flagsFor(mixed), false), [{ pkg: "WEB", flags: ["cert-expiring", "no-socials", "mixed-content"] }]);
});

test("flags from every check", () => {
  const checks = fixture({
    reachable: { status: "fail", details: { error: "timeout" } },
    https: { status: "fail" },
    speed: { status: "fail", details: { performance: 0.2 } },
    seo_basics: { status: "fail", details: { viewport: false } },
    contact: { status: "fail" },
    socials: { status: "fail" },
    schema: { status: "fail" },
    ai_ready: { status: "fail", details: { llmsTxt: false, chat: false } },
    google_listing: { status: "fail" },
    housekeeping: { status: "fail", details: { stale: true, mixedContent: true, legalLink: false } },
  });
  const s = auditScore(checks, { forbidsExtraction: true });
  assert.equal(s.score, 0);
  assert.deepEqual(s.flags, ["no-site", "no-ssl", "slow-mobile", "not-mobile", "no-contact", "no-booking", "no-socials", "no-schema", "blocks-ai", "no-chat", "no-gbp", "stale-site", "mixed-content", "forbids-extraction"]);
  assert.deepEqual(
    s.fits.map((f) => f.pkg),
    ["WEB", "AGENT", "AUTO"],
  );
  assert.deepEqual(s.fits[0]!.flags, ["no-site", "no-ssl", "slow-mobile", "not-mobile", "no-socials", "no-schema", "stale-site", "mixed-content"]);
  assert.deepEqual(s.fits[1]!.flags, ["no-contact", "blocks-ai", "no-chat"]);
  assert.deepEqual(s.fits[2]!.flags, ["no-booking"]);
});

test("partial statuses: contact without booking, bots allowed without chat, schema incomplete, seo one miss", () => {
  const s = auditScore(
    fixture({
      contact: { status: "partial", details: { channel: true, booking: false } },
      ai_ready: { status: "partial", details: { llmsTxt: false, chat: false } },
      schema: { status: "partial", details: { jsonLd: true, telephone: false } },
      seo_basics: { status: "partial", details: { viewport: true, description: false } },
      https: { status: "partial", details: { certDaysLeft: 200, hsts: false } },
    }),
  );
  assert.deepEqual(s.flags, ["no-booking", "no-chat"]);
  assert.deepEqual(s.fits, [
    { pkg: "AGENT", flags: ["no-chat"] },
    { pkg: "AUTO", flags: ["no-booking"] },
  ]);
  assert.equal(s.earned, 100 - 5 - 7 - 5 - 5 - 5);
  // ai_ready (15 → 8, deficit 7) beats the 10-point checks (deficit 5); ties keep the check order.
  assert.deepEqual(s.top, ["ai_ready", "https", "seo_basics"]);
});

test("not_measured checks never produce flags", () => {
  const s = auditScore(fixture({ housekeeping: { status: "not_measured", details: { stale: true, mixedContent: true } }, google_listing: { status: "not_measured" } }));
  assert.deepEqual(s.flags, []);
  assert.equal(s.measured, 85);
});

test("topChecks: largest deficit first, then weight, then order; capped at three", () => {
  const checks = fixture({
    socials: { status: "fail" }, // deficit 5
    speed: { status: "fail" }, // 15
    ai_ready: { status: "partial", details: { timedOut: false } }, // 7
    https: { status: "fail" }, // 10
    contact: { status: "fail" }, // 10
  });
  assert.deepEqual(topChecks(checks), ["speed", "https", "contact"]);
  assert.deepEqual(topChecks(checks, 5), ["speed", "https", "contact", "ai_ready", "socials"]);
});

test("a hand-built C site lands under 50 with WEB first", () => {
  const s = auditScore(
    fixture({
      https: { status: "fail" },
      speed: { status: "fail", details: { performance: 0.31 } },
      seo_basics: { status: "partial", details: { viewport: true } },
      contact: { status: "partial", details: { channel: true, booking: false } },
      socials: { status: "fail" },
      schema: { status: "fail" },
      ai_ready: { status: "partial", details: { llmsTxt: false, chat: false } },
      google_listing: { status: "not_measured" },
      housekeeping: { status: "partial", details: { stale: true, mixedContent: false } },
    }),
  );
  assert.equal(s.measured, 90);
  assert.equal(s.earned, 10 + 0 + 0 + 5 + 5 + 0 + 0 + 8 + 3);
  assert.equal(s.score, 34);
  assert.equal(s.grade, "C");
  assert.equal(s.fits[0]!.pkg, "WEB");
  assert.deepEqual(s.top, ["speed", "https", "schema"]);
});
