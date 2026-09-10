// Turns a stored audit (checks, flags, fits, top) into the words a prospect
// reads: the ten check rows, the three findings that matter most, the
// "what we would do first" lines with the /pme package labels, and the
// plain-words list the draft prompt gets. Pure — no DB, no next/*, no env —
// so node --test loads it (relative imports with extensions, `import type`
// for every type; no enums or parameter properties).
import type { AuditChecks, CheckKey, CheckResult, CheckStatus, FitSuggestion, Flag } from "../crm/types.ts";
import { CHECK_COPY, FLAG_COPY, INTERNAL_FLAGS, PACKAGE_ACTIONS, PACKAGE_LABELS, STATUS_LABELS, packageKeyFor } from "../../content/auditChecks.ts";
import { TRADE_LABELS, type ReportLocale } from "../../content/report.ts";

/** Display order of the ten checks (contract §7.2 table order). */
export const CHECK_ORDER: readonly CheckKey[] = [
  "reachable",
  "https",
  "speed",
  "seo_basics",
  "contact",
  "socials",
  "schema",
  "ai_ready",
  "google_listing",
  "housekeeping",
];

// Mirror of CHECK_WEIGHTS (crm/types.ts) — kept local so this module imports
// nothing at runtime from a file that also carries the Google adapter stub.
const WEIGHTS: Record<CheckKey, number> = {
  reachable: 10,
  https: 10,
  speed: 15,
  seo_basics: 10,
  contact: 10,
  socials: 5,
  schema: 10,
  ai_ready: 15,
  google_listing: 10,
  housekeeping: 5,
};

export interface CheckRow {
  key: CheckKey;
  name: string;
  status: CheckStatus;
  statusLabel: string;
  text: string;
  points: number;
  weight: number;
  measured: boolean;
}

export interface FirstStep {
  pkg: FitSuggestion["pkg"];
  label: string;
  action: string;
  /** Plain-words flags behind the suggestion, already joined for display ("" when none). */
  why: string;
}

const isCheckKey = (k: unknown): k is CheckKey => typeof k === "string" && (CHECK_ORDER as readonly string[]).includes(k);

/** A check's stored result, or a synthetic not_measured row when the audit has none. */
function resultFor(checks: AuditChecks | null | undefined, key: CheckKey): CheckResult {
  const r = checks?.[key];
  if (r && typeof r === "object") {
    const status: CheckStatus = r.status === "pass" || r.status === "partial" || r.status === "fail" ? r.status : "not_measured";
    return { key, status, points: Number(r.points) || 0, measured: status !== "not_measured" && r.measured !== false, details: r.details ?? {} };
  }
  return { key, status: "not_measured", points: 0, measured: false, details: {} };
}

/** Sentence for one check, in the prospect's language. The no-site case gets its own words. */
export function checkText(key: CheckKey, status: CheckStatus, flags: readonly Flag[], locale: ReportLocale): string {
  if (key === "reachable" && flags.includes("no-site")) {
    return locale === "fr" ? "Nous n'avons pas trouvé de site internet pour votre établissement." : "We could not find a website for your business.";
  }
  return CHECK_COPY[key][status][locale];
}

/** The ten rows in display order — every key present, unmeasured ones included. */
export function checkRows(checks: AuditChecks | null | undefined, flags: readonly Flag[], locale: ReportLocale): CheckRow[] {
  return CHECK_ORDER.map((key) => {
    const r = resultFor(checks, key);
    return {
      key,
      name: CHECK_COPY[key].label[locale],
      status: r.status,
      statusLabel: STATUS_LABELS[r.status][locale],
      text: checkText(key, r.status, flags, locale),
      points: r.points,
      weight: WEIGHTS[key],
      measured: r.measured,
    };
  });
}

/**
 * The three findings that matter most: the audit's stored `top` keys in order,
 * or — when `top` is empty or stale — the measured checks with the largest
 * shortfall. Passing checks are never a "finding".
 */
export function topFindings(
  checks: AuditChecks | null | undefined,
  flags: readonly Flag[],
  top: readonly unknown[] | null | undefined,
  locale: ReportLocale,
  limit = 3,
): CheckRow[] {
  const rows = checkRows(checks, flags, locale);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const chosen: CheckRow[] = [];
  for (const k of top ?? []) {
    const row = isCheckKey(k) ? byKey.get(k) : undefined;
    if (row && row.measured && row.status !== "pass" && !chosen.includes(row)) chosen.push(row);
    if (chosen.length >= limit) return chosen;
  }
  const rest = rows
    .filter((r) => r.measured && r.status !== "pass" && !chosen.includes(r))
    .sort((a, b) => b.weight - b.points - (a.weight - a.points) || CHECK_ORDER.indexOf(a.key) - CHECK_ORDER.indexOf(b.key));
  return [...chosen, ...rest].slice(0, limit);
}

/** Package label from /pme — WEB reads "Site + IA" when there is no site at all. */
export function packageLabel(pkg: FitSuggestion["pkg"], flags: readonly Flag[], locale: ReportLocale): string {
  return PACKAGE_LABELS[packageKeyFor(pkg, flags)][locale];
}

/** Plain words for a list of flags, internal flags dropped, order kept. */
export function flagWords(flags: readonly Flag[], locale: ReportLocale): string[] {
  const out: string[] = [];
  for (const f of flags) {
    if (INTERNAL_FLAGS.has(f)) continue;
    const w = FLAG_COPY[f]?.[locale];
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * "What we would do first": one line per suggested package (the audit's fit
 * order — WEB, AGENT, AUTO, SEC as score.ts emits them), at most `limit`.
 * An audit with no fits returns [] and the page shows the all-good line.
 */
export function firstSteps(fits: readonly FitSuggestion[] | null | undefined, flags: readonly Flag[], locale: ReportLocale, limit = 3): FirstStep[] {
  const out: FirstStep[] = [];
  const seen = new Set<string>();
  for (const fit of fits ?? []) {
    if (!fit || (fit.pkg !== "WEB" && fit.pkg !== "AGENT" && fit.pkg !== "AUTO" && fit.pkg !== "SEC")) continue;
    const key = packageKeyFor(fit.pkg, flags);
    const label = PACKAGE_LABELS[key][locale];
    // AGENT and AUTO share a label; two lines with the same label read as a
    // duplicate, so the second one is folded into the first.
    if (seen.has(label)) {
      const first = out.find((s) => s.label === label);
      if (first) {
        const extra = flagWords(fit.flags ?? [], locale).filter((w) => !first.why.includes(w));
        if (extra.length) first.why = [first.why, ...extra].filter(Boolean).join(", ");
      }
      continue;
    }
    seen.add(label);
    out.push({ pkg: fit.pkg, label, action: PACKAGE_ACTIONS[key][locale], why: flagWords(fit.flags ?? [], locale).join(", ") });
    if (out.length >= limit) break;
  }
  return out;
}

/** The Google line, in our words only — never a quote from a listing. */
export function googleLine(checks: AuditChecks | null | undefined, locale: ReportLocale): string {
  const r = resultFor(checks, "google_listing");
  return CHECK_COPY.google_listing[r.status][locale];
}

/** Trade in words for a stored trade_key (fixed key → label; custom label as is; null → null). */
export function tradeWords(tradeKey: string | null | undefined, locale: ReportLocale): string | null {
  if (!tradeKey) return null;
  const t = tradeKey.trim();
  if (!t) return null;
  return TRADE_LABELS[t]?.[locale] ?? t;
}

/**
 * Findings in plain words for the draft prompt and the templates: the top
 * findings as "name: sentence" lines, then the remaining flags that no
 * finding already covers.
 */
export function findingsInPlainWords(
  checks: AuditChecks | null | undefined,
  flags: readonly Flag[],
  top: readonly unknown[] | null | undefined,
  locale: ReportLocale,
): string[] {
  return topFindings(checks, flags, top, locale).map((r) => (locale === "fr" ? `${r.name} : ${r.text}` : `${r.name}: ${r.text}`));
}

/** Counts a draft or a page can quote: "n of 10 in place, k to look at". */
export function checkCounts(checks: AuditChecks | null | undefined): { measured: number; pass: number; attention: number } {
  let measured = 0;
  let pass = 0;
  for (const key of CHECK_ORDER) {
    const r = resultFor(checks, key);
    if (!r.measured) continue;
    measured++;
    if (r.status === "pass") pass++;
  }
  return { measured, pass, attention: measured - pass };
}
