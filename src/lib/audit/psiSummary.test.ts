import { test } from "node:test";
import assert from "node:assert/strict";
import { summarisePsi, timedOutSummary } from "./psiSummary.ts";

const AT = "2026-09-10T12:00:00.000Z";

const body = {
  id: "https://www.example.fr/",
  loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 } } },
  lighthouseResult: {
    requestedUrl: "https://www.example.fr/",
    categories: { performance: { score: 0.734 }, seo: { score: 0.92 } },
    audits: {
      "largest-contentful-paint": { score: 0.8, numericValue: 1834.6 },
      "cumulative-layout-shift": { score: 1, numericValue: 0.01234 },
      viewport: { score: 1 },
      "document-title": { score: 0 },
      "meta-description": { score: 1 },
      "unused-javascript": { score: 0.2, details: { items: [{ url: "https://cdn/x.js" }] } },
    },
  },
};

test("summarisePsi keeps the scalars the checks read and nothing else", () => {
  const s = summarisePsi(body, AT);
  assert.deepEqual(s, { performance: 0.73, seo: 0.92, lcpMs: 1835, cls: 0.012, viewport: true, title: false, description: true, fetchedAt: AT, timedOut: false });
  assert.deepEqual(Object.keys(s).sort(), ["cls", "description", "fetchedAt", "lcpMs", "performance", "seo", "timedOut", "title", "viewport"]);
});

test("summarisePsi: missing pieces become null; no performance score means a timed-out summary", () => {
  const partial = summarisePsi({ lighthouseResult: { categories: { performance: { score: 0.5 } } } }, AT);
  assert.deepEqual(partial, { performance: 0.5, seo: null, lcpMs: null, cls: null, viewport: null, title: null, description: null, fetchedAt: AT, timedOut: false });
  assert.deepEqual(summarisePsi({ lighthouseResult: { categories: { seo: { score: 0.9 } } } }, AT), timedOutSummary(AT));
  assert.deepEqual(summarisePsi({ error: { code: 500 } }, AT), timedOutSummary(AT));
  assert.deepEqual(summarisePsi(null, AT), timedOutSummary(AT));
  assert.deepEqual(summarisePsi("junk", AT), timedOutSummary(AT));
  assert.equal(summarisePsi({ lighthouseResult: { categories: { performance: { score: 1.5 } } } }, AT).timedOut, true);
  assert.equal(timedOutSummary(AT).timedOut, true);
  assert.equal(timedOutSummary(AT).performance, null);
});
