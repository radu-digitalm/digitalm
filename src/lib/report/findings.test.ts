import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuditChecks, CheckKey, CheckResult, CheckStatus, FitSuggestion, Flag } from "../crm/types.ts";
import {
  CHECK_ORDER,
  checkCounts,
  checkRows,
  findingsInPlainWords,
  firstSteps,
  flagWords,
  googleLine,
  packageLabel,
  topFindings,
  tradeWords,
} from "./findings.ts";

const WEIGHT: Record<CheckKey, number> = {
  reachable: 10, https: 10, speed: 15, seo_basics: 10, contact: 10, socials: 5, schema: 10, ai_ready: 15, google_listing: 10, housekeeping: 5,
};

function result(key: CheckKey, status: CheckStatus): CheckResult {
  const w = WEIGHT[key];
  const points = status === "pass" ? w : status === "partial" ? Math.round(w / 2) : 0;
  return { key, status, points, measured: status !== "not_measured", details: {} };
}

function checks(overrides: Partial<Record<CheckKey, CheckStatus>> = {}): AuditChecks {
  const out = {} as AuditChecks;
  for (const k of CHECK_ORDER) out[k] = result(k, overrides[k] ?? "pass");
  return out;
}

test("checkRows: ten rows in contract order, unmeasured rows included", () => {
  const rows = checkRows(checks({ google_listing: "not_measured", https: "fail" }), ["no-ssl"], "fr");
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((r) => r.key), [...CHECK_ORDER]);
  assert.equal(rows[1]!.status, "fail");
  assert.equal(rows[1]!.statusLabel, "À corriger");
  assert.match(rows[1]!.text, /HTTPS/);
  assert.equal(rows[8]!.measured, false);
  assert.equal(rows[8]!.text, "Nous n'avons pas vérifié votre fiche Google.");
  // A missing checks blob still yields ten rows, all not measured.
  const empty = checkRows(null, [], "en");
  assert.equal(empty.length, 10);
  assert.ok(empty.every((r) => r.status === "not_measured"));
});

test("checkRows: the AI-readability failure says 'cannot read', never 'error'", () => {
  const rows = checkRows(checks({ ai_ready: "fail" }), ["blocks-ai"], "en");
  const ai = rows.find((r) => r.key === "ai_ready")!;
  assert.equal(ai.text, "AI assistants cannot read your site.");
  assert.doesNotMatch(ai.text, /error/i);
  const fr = checkRows(checks({ ai_ready: "fail" }), ["blocks-ai"], "fr").find((r) => r.key === "ai_ready")!;
  assert.equal(fr.text, "Les assistants IA ne peuvent pas lire votre site.");
});

test("checkRows: no-site gets its own reachable sentence", () => {
  const c = checks();
  for (const k of CHECK_ORDER) c[k] = result(k, "not_measured");
  c.reachable = result("reachable", "fail");
  const row = checkRows(c, ["no-site"], "fr")[0]!;
  assert.match(row.text, /pas trouvé de site internet/);
  assert.match(checkRows(c, ["no-site"], "en")[0]!.text, /could not find a website/);
});

test("topFindings: follows the stored top order, skips passes, pads from the worst shortfall", () => {
  const c = checks({ speed: "fail", https: "partial", contact: "fail", socials: "fail" });
  const top = topFindings(c, [], ["speed", "contact", "https"], "en");
  assert.deepEqual(top.map((r) => r.key), ["speed", "contact", "https"]);
  // A pass listed in top is ignored; the slot is filled by the largest remaining shortfall.
  const padded = topFindings(c, [], ["schema", "speed"], "en");
  assert.equal(padded.length, 3);
  assert.equal(padded[0]!.key, "speed");
  assert.ok(!padded.some((r) => r.key === "schema"));
  // Empty top → worst three by weight − points.
  const auto = topFindings(c, [], [], "en");
  assert.deepEqual(auto.map((r) => r.key), ["speed", "contact", "https"]);
  // All passing → nothing to report.
  assert.deepEqual(topFindings(checks(), [], ["speed"], "fr"), []);
  // Garbage in top is ignored, never thrown on.
  assert.equal(topFindings(c, [], ["nope", 42, null], "fr").length, 3);
});

test("packageLabel / firstSteps: /pme labels verbatim, WEB reads Site + IA without a site", () => {
  assert.equal(packageLabel("WEB", [], "fr"), "Site essentiel — à partir de 500 €");
  assert.equal(packageLabel("WEB", [], "en"), "Site essentiel — from €500");
  assert.equal(packageLabel("WEB", ["no-site"], "fr"), "Site + IA — à partir de 2 500 €");
  assert.equal(packageLabel("WEB", ["no-site"], "en"), "Site + AI — from €2,500");
  assert.equal(packageLabel("AGENT", [], "fr"), "L'IA sur votre site — à partir de 500 €");
  assert.equal(packageLabel("AUTO", [], "en"), "AI on your site — from €500");
  assert.equal(packageLabel("SEC", [], "fr"), "Audit de sécurité e-commerce — à partir de 500 €/jour");
  assert.equal(packageLabel("SEC", [], "en"), "E-commerce security audit — from €500/day");

  const fits: FitSuggestion[] = [
    { pkg: "WEB", flags: ["no-ssl", "slow-mobile"] },
    { pkg: "AGENT", flags: ["no-chat"] },
    { pkg: "AUTO", flags: ["no-booking"] },
    { pkg: "SEC", flags: ["no-ssl"] },
  ];
  const steps = firstSteps(fits, ["no-ssl", "slow-mobile", "no-chat", "no-booking"], "fr");
  assert.ok(steps.length <= 3);
  assert.equal(steps[0]!.label, "Site essentiel — à partir de 500 €");
  assert.match(steps[0]!.why, /HTTPS/);
  assert.match(steps[0]!.why, /lent sur mobile/);
  // AGENT and AUTO share a label: folded into one line, the AUTO flag kept in "why".
  const labels = steps.map((s) => s.label);
  assert.equal(new Set(labels).size, labels.length);
  const ai = steps.find((s) => s.pkg === "AGENT")!;
  assert.match(ai.why, /discussion en ligne/);
  assert.match(ai.why, /rendez-vous/);
  assert.equal(steps[2]!.pkg, "SEC");
  assert.deepEqual(firstSteps([], [], "en"), []);
  assert.deepEqual(firstSteps(null, [], "en"), []);
});

test("googleLine: our words only, per status", () => {
  assert.equal(googleLine(checks({ google_listing: "not_measured" }), "en"), "We have not checked your Google listing.");
  assert.equal(googleLine(checks({ google_listing: "fail" }), "fr"), "Nous n'avons pas trouvé de fiche Google pour votre établissement.");
  assert.equal(googleLine(checks(), "en"), "Your Google listing is in place.");
  assert.equal(googleLine(null, "fr"), "Nous n'avons pas vérifié votre fiche Google.");
});

test("flagWords / tradeWords / findingsInPlainWords / checkCounts", () => {
  const flags: Flag[] = ["blocks-ai", "forbids-extraction", "no-gbp", "blocks-ai"];
  assert.deepEqual(flagWords(flags, "en"), ["AI assistants cannot read your site", "no Google listing found"]);
  assert.equal(tradeWords("bakery", "fr"), "boulangerie");
  assert.equal(tradeWords("bakery", "en"), "bakery");
  assert.equal(tradeWords("Tattoo studio", "fr"), "Tattoo studio");
  assert.equal(tradeWords(null, "fr"), null);
  assert.equal(tradeWords("  ", "en"), null);

  const c = checks({ speed: "fail", schema: "fail", google_listing: "not_measured" });
  const words = findingsInPlainWords(c, ["slow-mobile", "no-schema"], ["speed", "schema"], "fr");
  assert.equal(words.length, 2);
  assert.match(words[0]!, /^Vitesse sur mobile : /);
  assert.match(findingsInPlainWords(c, [], ["speed"], "en")[0]!, /^Mobile speed: /);
  assert.deepEqual(checkCounts(c), { measured: 9, pass: 7, attention: 2 });
  assert.deepEqual(checkCounts(null), { measured: 0, pass: 0, attention: 0 });
});
