// What the progress bar and its sentence say (docs/finder-ux-spec.md §5.6,
// QA round 1): pure functions over a SearchResultV2 and the current time,
// so node --test can drive them. The bar reserves room for every stage —
// map search, register, placing on the map — and never reads 100 % while
// the search runs; a single-area search moves with time against a soft
// estimate instead of sitting at 0 % then jumping to full.
import type { SearchResultV2 } from "../../lib/crm/types.ts";
import { formatDuration, formatEta, formatInt, relativeOrLocal } from "./format.ts";
import { FIND_TEXT, fill } from "./wording.ts";

/** "restaurants" from "Restaurant"; "bars / pubs" from "Bar / pub"; the singular (lower-case) when n is 1. */
export function tradePlural(label: string, n = 2): string {
  const lower = label.trim().toLowerCase();
  if (n === 1 || !lower) return lower;
  const one = (w: string) => (/(s|x|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  return lower
    .split(" / ")
    .map((part) => part.split(" and ").map(one).join(" and "))
    .join(" / ");
}

/** Where each stage ends on the bar (0–1). The last few percent belong to "finished". */
export const BAR = { start: 0.04, osmEndWithRegister: 0.6, osmEndAlone: 0.82, registerEnd: 0.88, placing: 0.95 } as const;

/** Soft duration of a single-area map search from the expected count: 8 s + 60 ms per business, 10…120 s. */
export function softUnitSeconds(expected: number | null): number | null {
  if (expected === null || !Number.isFinite(expected) || expected < 0) return null;
  return Math.max(10, Math.min(120, 8 + expected * 0.06));
}

export function unitsDone(r: SearchResultV2): { done: number; total: number } {
  const total = r.progress.units.length;
  const done = r.progress.units.filter((u) => u.state === "done" || u.state === "failed" || u.state === "skipped").length;
  return { done, total };
}

export function scopesDone(r: SearchResultV2): { done: number; total: number } {
  const total = r.progress.registerScopes.length;
  const done = r.progress.registerScopes.filter((s) => s.state === "done" || s.state === "failed" || s.state === "skipped").length;
  return { done, total };
}

/** The French register runs after the map for French areas when it was asked for. */
export function expectsRegister(r: SearchResultV2): boolean {
  return r.sources.includes("fr_register") && r.area.countryCode === "FR";
}

export function elapsedSeconds(r: SearchResultV2, now: number): number {
  const t = Date.parse(r.progress.startedAt);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : 0;
}

/**
 * 0–1 of the bar: the map phase fills its share unit by unit (a single unit
 * moves with elapsed time against the soft estimate, at most 90 % of its
 * share), the register phase page by page, then "placing" holds at 95 %
 * until the search is finished. Never 1 while running; null before any
 * information at all.
 */
export function progressFraction(r: SearchResultV2, now = Date.now()): number | null {
  const p = r.progress;
  if (p.status !== "running") return 1;
  const reg = expectsRegister(r);
  const osmEnd = reg ? BAR.osmEndWithRegister : BAR.osmEndAlone;
  if (p.stage === "osm") {
    const u = unitsDone(r);
    if (u.total === 0) return null;
    let inner = 0;
    if (u.done < u.total) {
      if (u.total === 1) {
        const soft = softUnitSeconds(p.expected);
        inner = soft ? Math.min(0.9, elapsedSeconds(r, now) / soft) : Math.min(0.9, elapsedSeconds(r, now) / 60);
      } else if (p.expected && p.expected > 0) {
        inner = Math.min(0.9, p.found / p.expected) / u.total;
      }
    }
    const frac = Math.min(0.98, u.done / u.total + inner);
    return BAR.start + frac * (osmEnd - BAR.start);
  }
  if (p.stage === "register") {
    const s = scopesDone(r);
    const running = p.registerScopes.find((x) => x.state === "running");
    const inner = running && running.totalPages ? Math.min(0.95, running.pages / running.totalPages) : 0;
    const frac = s.total > 0 ? Math.min(1, (s.done + inner) / s.total) : 0;
    return osmEnd + frac * (BAR.registerEnd - osmEnd);
  }
  return BAR.placing;
}

/** Seconds left, or null when nothing sensible can be said. */
export function etaSeconds(r: SearchResultV2, now = Date.now()): number | null {
  const p = r.progress;
  if (p.status !== "running") return null;
  if (p.stage === "osm") {
    const u = unitsDone(r);
    if (u.total > 1) return p.etaSeconds;
    const soft = softUnitSeconds(p.expected);
    if (soft === null) return null;
    const left = Math.round(soft - elapsedSeconds(r, now));
    return left > 0 ? left : null;
  }
  if (p.stage === "register") {
    const s = scopesDone(r);
    const running = p.registerScopes.find((x) => x.state === "running");
    const pagesLeft = running && running.totalPages ? Math.max(0, running.totalPages - running.pages) : 0;
    const scopesLeft = Math.max(0, s.total - s.done - (running ? 1 : 0));
    const est = Math.round(pagesLeft * 0.4 + scopesLeft * 4);
    return est > 0 ? est : null;
  }
  return null;
}

/** True when the single map search has outrun its soft estimate. */
export function runningLong(r: SearchResultV2, now = Date.now()): boolean {
  const p = r.progress;
  if (p.status !== "running" || p.stage !== "osm" || p.units.length !== 1) return false;
  const soft = softUnitSeconds(p.expected);
  return soft !== null && elapsedSeconds(r, now) > soft * 1.5;
}

/** The running sentence for the progress bar. */
export function runningText(r: SearchResultV2, now = Date.now()): string {
  const p = r.progress;
  if (p.retryingUntil) {
    const s = Math.max(1, Math.round((Date.parse(p.retryingUntil) - now) / 1000));
    if (Number.isFinite(s)) return fill(FIND_TEXT.retrying, { s });
  }
  const parts: string[] = [];
  if (p.stage === "osm") {
    const u = unitsDone(r);
    parts.push(u.total > 1 ? fill(FIND_TEXT.searchingOsm, { done: u.done, total: u.total }) : FIND_TEXT.searchingOsmOne);
    if (p.found > 0 || u.total > 1) parts.push(fill(FIND_TEXT.foundSoFar, { n: formatInt(p.found) }));
    const eta = formatEta(etaSeconds(r, now));
    if (eta) parts.push(fill(FIND_TEXT.eta, { s: eta }));
    else if (runningLong(r, now)) parts.push(FIND_TEXT.longerThanUsual);
  } else if (p.stage === "register") {
    const s = scopesDone(r);
    const current = p.registerScopes.find((x) => x.state === "running") ?? p.registerScopes[0];
    parts.push(s.total <= 1 && current ? fill(FIND_TEXT.checkingRegister, { done: current.pages, total: current.totalPages ?? "?" }) : fill(FIND_TEXT.checkingRegisterScopes, { done: s.done, total: s.total }));
    const eta = formatEta(etaSeconds(r, now));
    if (eta) parts.push(fill(FIND_TEXT.eta, { s: eta }));
  } else {
    parts.push(FIND_TEXT.placing);
  }
  parts.push(fill(FIND_TEXT.searchingFor, { s: formatDuration(elapsedSeconds(r, now) * 1000) || "0 s" }));
  return parts.join(" · ");
}

/** Rows found on the map and matched to the register. */
export function bothCount(r: SearchResultV2): number {
  return r.rows.filter((x) => x.sources.includes("osm") && x.sources.includes("fr_register")).length;
}

/**
 * When every map row was read well before the search started, the map part
 * came from the 24 h cache (the register is always read afresh): the ISO
 * time the map was read, else null.
 */
export function readFromCacheAt(r: SearchResultV2): string | null {
  const created = Date.parse(r.createdAt);
  let newest = Number.NEGATIVE_INFINITY;
  for (const row of r.rows) {
    if (!row.sources.includes("osm")) continue;
    const t = row.readAt ? Date.parse(row.readAt) : Number.NaN;
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!Number.isFinite(created) || !Number.isFinite(newest)) return null;
  return created - newest > 60_000 ? new Date(newest).toISOString() : null;
}

/** When the results date from: the map read time when the 24 h cache answered, else when the search ran. */
export function resultsAt(r: SearchResultV2): string {
  return readFromCacheAt(r) ?? r.createdAt;
}

/** "Results from 1 h ago" once the results are older than a minute; "" while they are fresh. */
export function resultsFromText(r: SearchResultV2, now = new Date()): string {
  const at = resultsAt(r);
  const t = Date.parse(at);
  if (!Number.isFinite(t) || now.getTime() - t < 60_000) return "";
  return fill(FIND_TEXT.resultsFrom, { when: relativeOrLocal(at, now) });
}

/** "572 restaurants" — the count with the trade in words (the sources split lives in the list pane). */
export function doneText(r: SearchResultV2): string {
  return fill(FIND_TEXT.found, { n: formatInt(r.total), trade: tradePlural(r.category.label.en || "business", r.total) });
}

/** "572 restaurants in Ariège" — the list pane's title and the phone sheet's. */
export function summaryText(r: SearchResultV2): string {
  return fill(FIND_TEXT.summary, { n: formatInt(r.total), trade: tradePlural(r.category.label.en || "business", r.total), area: r.area.label });
}

/** "Ariège — department, France"; the country is left out when it is the area itself ("Andorra — country"). */
export function resolvedText(area: { label: string; kind: string; countryName?: string; countryCode: string }, kindWord: string): string {
  const country = area.countryName || area.countryCode;
  if (!country || country === area.label) return `${area.label} — ${kindWord}`;
  return fill(FIND_TEXT.resolved, { area: area.label, kind: kindWord, country });
}
