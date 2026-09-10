// Pure scoring (contract §3 "Scoring", §7.2 flags and fits). No I/O, no Next,
// no DB: runs under node --test in strip-only mode (no enums / namespaces /
// parameter properties) and is imported by relative path.
//
// pass = weight, partial = round(weight / 2), fail = 0; not_measured leaves the
// denominator. score = round(100 × earned / measured); A ≥ 75, B 50–74, C < 50.
// Flags are derived from each check's status plus a few well-known `details`
// keys written by checks.ts; fits map flags to the /pme packages.
import { CHECK_WEIGHTS } from "../crm/types.ts";
import type { AuditChecks, CheckKey, CheckResult, CheckStatus, FitSuggestion, Flag, Score } from "../crm/types.ts";

export const CHECK_ORDER: CheckKey[] = ["reachable", "https", "speed", "seo_basics", "contact", "socials", "schema", "ai_ready", "google_listing", "housekeeping"];

export type Grade = "A" | "B" | "C";

export function gradeFor(score: number): Grade {
  return score >= 75 ? "A" : score >= 50 ? "B" : "C";
}

export function pointsFor(key: CheckKey, status: CheckStatus): number {
  const w = CHECK_WEIGHTS[key];
  if (status === "pass") return w;
  if (status === "partial") return Math.round(w / 2);
  return 0;
}

/** Build one CheckResult with points and `measured` derived from the status. */
export function makeCheck(key: CheckKey, status: CheckStatus, details: CheckResult["details"] = {}): CheckResult {
  return { key, status, points: pointsFor(key, status), measured: status !== "not_measured", details };
}

/** Every check not_measured except reachable = fail (no website, or an unusable URL). */
export function noSiteChecks(reachableDetails: CheckResult["details"] = { error: "no_website" }): AuditChecks {
  const out = {} as AuditChecks;
  for (const key of CHECK_ORDER) out[key] = makeCheck(key, key === "reachable" ? "fail" : "not_measured", key === "reachable" ? reachableDetails : {});
  return out;
}

// ---- flags -------------------------------------------------------------------------

export interface ScoreContext {
  /** Cart/checkout links or a shop CMS: security flags go to SEC instead of WEB. */
  ecommerce?: boolean;
  /** The legal page forbids extraction / prospecting (§7.2). */
  forbidsExtraction?: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Flags implied by the ten checks (measured ones only) and the context. Stable order, no duplicates. */
export function flagsFor(checks: AuditChecks, ctx: ScoreContext = {}): Flag[] {
  const flags: Flag[] = [];
  const add = (f: Flag) => {
    if (!flags.includes(f)) flags.push(f);
  };
  const c = (key: CheckKey) => checks[key];

  if (c("reachable")?.status === "fail") add("no-site");

  const https = c("https");
  if (https?.status === "fail") add("no-ssl");
  else if (https?.status === "partial") {
    const days = num(https.details.certDaysLeft);
    if (days !== null && days < 30) add("cert-expiring");
  }

  const speed = c("speed");
  if (speed?.status === "fail") add("slow-mobile");
  else if (speed?.status === "partial" && speed.details.timedOut !== true) add("slow-mobile");

  const seo = c("seo_basics");
  if (seo?.status === "fail" && seo.details.viewport === false) add("not-mobile");

  const contact = c("contact");
  if (contact?.status === "fail") {
    add("no-contact");
    add("no-booking");
  } else if (contact?.status === "partial") {
    if (contact.details.booking === false) add("no-booking");
    if (contact.details.channel === false) add("no-contact");
  }

  if (c("socials")?.status === "fail") add("no-socials");
  if (c("schema")?.status === "fail") add("no-schema");

  const ai = c("ai_ready");
  if (ai?.status === "fail") {
    add("blocks-ai");
    if (ai.details.llmsTxt !== true && ai.details.chat !== true) add("no-chat");
  } else if (ai?.status === "partial") add("no-chat");

  if (c("google_listing")?.status === "fail") add("no-gbp");

  const hk = c("housekeeping");
  if (hk?.measured) {
    if (hk.details.stale === true) add("stale-site");
    if (hk.details.mixedContent === true) add("mixed-content");
  }

  if (ctx.forbidsExtraction) add("forbids-extraction");
  return flags;
}

// ---- fits --------------------------------------------------------------------------

const WEB_FLAGS: Flag[] = ["no-site", "no-ssl", "cert-expiring", "mixed-content", "slow-mobile", "not-mobile", "stale-site", "no-schema", "no-socials"];
const AGENT_FLAGS: Flag[] = ["no-chat", "blocks-ai", "no-contact"];
const AUTO_FLAGS: Flag[] = ["no-booking"];
const SEC_FLAGS: Flag[] = ["no-ssl", "cert-expiring", "mixed-content"];
const PKG_ORDER: FitSuggestion["pkg"][] = ["WEB", "AGENT", "AUTO", "SEC"];

/**
 * Package suggestions from flags. SEC takes the security flags only when the
 * e-commerce signal is present, and WEB then drops them (§7.2).
 */
export function fitsFor(flags: Flag[], ecommerce = false): FitSuggestion[] {
  const pick = (allowed: Flag[]) => flags.filter((f) => allowed.includes(f));
  const sec = ecommerce ? pick(SEC_FLAGS) : [];
  const web = pick(WEB_FLAGS).filter((f) => !sec.includes(f));
  const candidates: FitSuggestion[] = [
    { pkg: "WEB", flags: web },
    { pkg: "AGENT", flags: pick(AGENT_FLAGS) },
    { pkg: "AUTO", flags: pick(AUTO_FLAGS) },
    { pkg: "SEC", flags: sec },
  ];
  return candidates
    .filter((f) => f.flags.length > 0)
    .sort((a, b) => b.flags.length - a.flags.length || PKG_ORDER.indexOf(a.pkg) - PKG_ORDER.indexOf(b.pkg));
}

// ---- score ------------------------------------------------------------------------

/** The three measured checks with the largest weight − points (zero deficits excluded). */
export function topChecks(checks: AuditChecks, n = 3): CheckKey[] {
  return CHECK_ORDER.filter((key) => checks[key]?.measured && CHECK_WEIGHTS[key] - checks[key].points > 0)
    .sort((a, b) => {
      const da = CHECK_WEIGHTS[a] - checks[a].points;
      const db = CHECK_WEIGHTS[b] - checks[b].points;
      return db - da || CHECK_WEIGHTS[b] - CHECK_WEIGHTS[a] || CHECK_ORDER.indexOf(a) - CHECK_ORDER.indexOf(b);
    })
    .slice(0, n);
}

export function auditScore(checks: AuditChecks, ctx: ScoreContext = {}): Score {
  let earned = 0;
  let measured = 0;
  for (const key of CHECK_ORDER) {
    const c = checks[key];
    if (!c || !c.measured) continue;
    measured += CHECK_WEIGHTS[key];
    earned += Math.max(0, Math.min(CHECK_WEIGHTS[key], c.points));
  }
  const score = measured > 0 ? Math.round((100 * earned) / measured) : 0;
  const flags = flagsFor(checks, ctx);
  return { score, grade: gradeFor(score), earned, measured, flags, fits: fitsFor(flags, ctx.ecommerce === true), top: topChecks(checks) };
}
