"use client";

// Status line, progress bar and banners of the finder (docs/finder-ux-spec.md
// §5.6) plus the over-cap gate panel (CapGate, rendered in the list pane).
// Every sentence comes from wording.ts; notes arrive as text from the server.
import { isTerminal, type Alternative, type GateChild, type GatePlan, type ResolvedArea, type SearchResultV2 } from "./finderApi";
import { Button } from "./Button";
import { formatDuration, formatEta, formatInt } from "./format";
import { AREA_KIND_WORDS, CHILD_KIND_WORDS, FIND_TEXT, fill } from "./wording";

export type Phase = "idle" | "resolving" | "gate" | "running" | "finished";

export type FindErrorView = { text: string; running?: { searchId: number; area: string; trade: string } } | null;

export type StartInfo = { area: ResolvedArea; expected: number | null; alternatives?: Alternative[] } | null;

/** "restaurants" from "Restaurant"; "bars / pubs" from "Bar / pub". */
export function tradePlural(label: string, n = 2): string {
  const lower = label.trim().toLowerCase();
  if (n === 1 || !lower) return lower;
  const one = (w: string) => (/(s|x|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  return lower
    .split(" / ")
    .map((part) => part.split(" and ").map(one).join(" and "))
    .join(" / ");
}

function unitsDone(r: SearchResultV2): { done: number; total: number } {
  const total = r.progress.units.length;
  const done = r.progress.units.filter((u) => u.state === "done" || u.state === "failed" || u.state === "skipped").length;
  return { done, total };
}

function scopesDone(r: SearchResultV2): { done: number; total: number } {
  const total = r.progress.registerScopes.length;
  const done = r.progress.registerScopes.filter((s) => s.state === "done" || s.state === "failed" || s.state === "skipped").length;
  return { done, total };
}

/** The running sentence for the progress bar. */
export function runningText(r: SearchResultV2, now = Date.now()): string {
  const p = r.progress;
  if (p.retryingUntil) {
    const s = Math.max(1, Math.round((Date.parse(p.retryingUntil) - now) / 1000));
    if (Number.isFinite(s)) return fill(FIND_TEXT.retrying, { s });
  }
  if (p.stage === "osm") {
    const u = unitsDone(r);
    const parts = [u.total > 1 ? fill(FIND_TEXT.searchingOsm, { done: u.done, total: u.total }) : FIND_TEXT.searchingOsmOne, fill(FIND_TEXT.foundSoFar, { n: formatInt(p.found) })];
    const eta = formatEta(p.etaSeconds);
    if (eta) parts.push(fill(FIND_TEXT.eta, { s: eta }));
    return parts.join(" · ");
  }
  if (p.stage === "register") {
    const s = scopesDone(r);
    const current = p.registerScopes.find((x) => x.state === "running") ?? p.registerScopes[0];
    if (s.total <= 1 && current) return fill(FIND_TEXT.checkingRegister, { done: current.pages, total: current.totalPages ?? "?" });
    return fill(FIND_TEXT.checkingRegisterScopes, { done: s.done, total: s.total });
  }
  return FIND_TEXT.placing;
}

/** 0–1 of the bar, or null while nothing measurable has happened. */
export function progressFraction(r: SearchResultV2): number | null {
  const u = unitsDone(r);
  const s = scopesDone(r);
  const total = u.total + s.total;
  if (total === 0) return null;
  return (u.done + s.done) / total;
}

function bothCount(r: SearchResultV2): number {
  return r.rows.filter((x) => x.sources.includes("osm") && x.sources.includes("fr_register")).length;
}

export function doneText(r: SearchResultV2): string {
  const hasRegister = r.sources.includes("fr_register") && r.area.countryCode === "FR";
  const duration = formatDuration(r.durationMs);
  const text = !hasRegister
    ? fill(FIND_TEXT.doneNoRegister, { n: formatInt(r.total), area: r.area.label, onMap: formatInt(r.perSource.osm ?? 0), duration })
    : fill(FIND_TEXT.done, { n: formatInt(r.total), area: r.area.label, onMap: formatInt(r.perSource.osm ?? 0), inRegister: formatInt(r.perSource.fr_register ?? 0), inBoth: formatInt(bothCount(r)), duration });
  // No duration yet (legacy rows) → drop the trailing " · ." part.
  return duration ? text : text.replace(/ · \.$/, ".");
}

const BANNER_CODES = new Set(["capped", "units_failed", "register_failed", "interrupted", "expired", "time_limit", "unit_truncated"]);

export type FindProgressProps = {
  phase: Phase;
  query: string;
  start: StartInfo;
  result: SearchResultV2 | null;
  error: FindErrorView;
  expired: boolean;
  onContinue: () => void;
  onRunAgain: () => void;
  onOpenRunning: (id: number) => void;
  onStopRunning: (id: number) => void;
  onPickAlternative: (a: Alternative) => void;
  onPickChild: (c: GateChild) => void;
  capChildren: GateChild[] | null;
};

export function FindProgress(p: FindProgressProps) {
  const r = p.result;
  const area = r?.area ?? p.start?.area ?? null;
  const expected = r?.progress.expected ?? p.start?.expected ?? null;
  const trade = r?.category.label.en ?? "";
  const status = r?.progress.status ?? null;
  const running = p.phase === "running" && (!status || !isTerminal(status));

  const resolvedLine = area ? fill(FIND_TEXT.resolved, { area: area.label, kind: AREA_KIND_WORDS[area.kind] ?? area.kind, country: area.countryName || area.countryCode }) : null;
  const estimateLine = area ? (expected !== null ? fill(FIND_TEXT.estimate, { n: formatInt(expected), trade: tradePlural(trade || "business", expected) }) : running ? FIND_TEXT.estimateUnknown : "") : "";

  const alternatives = p.start?.alternatives ?? r?.alternatives ?? [];
  const notes = r?.notes ?? [];
  const banners = notes.filter((n) => BANNER_CODES.has(n.code));
  const plain = notes.filter((n) => !BANNER_CODES.has(n.code));

  let action: React.ReactNode = null;
  if (!running && r) {
    if (status === "partial" || status === "interrupted" || status === "cancelled") {
      action = (
        <Button size="sm" onClick={p.onContinue}>
          {status === "partial" ? FIND_TEXT.retryMissing : FIND_TEXT.continueBtn}
        </Button>
      );
    } else if (status === "failed" || status === "expired") {
      action = (
        <Button size="sm" onClick={p.onRunAgain}>
          {FIND_TEXT.runAgain}
        </Button>
      );
    }
  }

  const fraction = r ? progressFraction(r) : null;
  const valueMax = r ? Math.max(1, r.progress.units.length + r.progress.registerScopes.length) : 1;
  const valueNow = r ? Math.round((fraction ?? 0) * valueMax) : 0;

  return (
    <div className="space-y-1.5" aria-live="polite">
      {p.error ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[15px] text-accent-soft">
          <span>{p.error.text}</span>
          {p.error.running ? (
            <>
              <Button size="sm" onClick={() => p.onOpenRunning(p.error!.running!.searchId)}>
                {FIND_TEXT.openIt}
              </Button>
              <Button size="sm" variant="danger" onClick={() => p.onStopRunning(p.error!.running!.searchId)}>
                {FIND_TEXT.stopIt}
              </Button>
            </>
          ) : null}
        </p>
      ) : null}

      {p.phase === "resolving" ? (
        <div>
          <p className="text-[15px] text-fg-muted">{fill(FIND_TEXT.resolving, { query: p.query })}</p>
          <div className="mt-1 h-1 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-label={fill(FIND_TEXT.resolving, { query: p.query })}>
            <div className="dm-bar-indeterminate h-full bg-accent-magenta" />
          </div>
        </div>
      ) : null}

      {area && (p.phase === "running" || p.phase === "finished") ? (
        <p className="text-[15px] text-fg">
          <span className="text-fg-heading">{resolvedLine}</span>
          {estimateLine ? <span className="text-fg-muted"> · {estimateLine}</span> : null}
        </p>
      ) : null}

      {alternatives.length > 0 && (p.phase === "running" || p.phase === "finished") ? (
        <p className="text-[14px] text-fg-muted">
          {FIND_TEXT.notThisPlace}{" "}
          {alternatives.map((a, i) => (
            <span key={`${a.osmType}${a.osmId}`}>
              {i > 0 ? " · " : ""}
              <button type="button" className="link-accent" onClick={() => p.onPickAlternative(a)}>
                {a.label}
              </button>
            </span>
          ))}
        </p>
      ) : null}

      {running && r ? (
        <div>
          <p className="text-[15px] text-fg-heading">{runningText(r)}</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={valueMax} aria-valuenow={valueNow} aria-label={runningText(r)}>
            <div className={fraction === null ? "dm-bar-indeterminate h-full bg-accent-magenta" : "h-full bg-accent-magenta transition-[width] duration-500"} style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
          </div>
        </div>
      ) : running && !r ? (
        <div>
          <p className="text-[15px] text-fg-heading">{FIND_TEXT.searchingOsmOne}…</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={0} aria-label={FIND_TEXT.searchingOsmOne}>
            <div className="dm-bar-indeterminate h-full bg-accent-magenta" />
          </div>
        </div>
      ) : null}

      {!running && r && p.phase === "finished" ? (
        <div className="space-y-1.5">
          {status === "done" || status === "capped" || status === "partial" ? (
            r.total === 0 && status === "done" ? (
              <p className="text-[15px] text-fg-heading" data-testid="find-status">
                {fill(FIND_TEXT.empty, { trade: tradePlural(trade || "business"), area: r.area.label })}
              </p>
            ) : (
              <p className="text-[15px] text-fg-heading" data-testid="find-status">
                {doneText(r)}
              </p>
            )
          ) : status === "cancelled" ? (
            <p className="text-[15px] text-fg-heading" data-testid="find-status">
              {fill(FIND_TEXT.cancelled, { done: unitsDone(r).done, total: unitsDone(r).total, n: formatInt(r.total) })}
            </p>
          ) : status === "failed" ? (
            <p className="text-[15px] text-accent-soft" data-testid="find-status" role="alert">
              {ERROR_FALLBACK}
            </p>
          ) : null}
          {banners.length > 0 || action ? (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[15px] text-amber-200">
              {banners.map((n, i) => (
                <p key={i}>{n.text}</p>
              ))}
              {p.capChildren && p.capChildren.length > 0 && status === "capped" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[14px]">{FIND_TEXT.searchDepartment}</span>
                  {p.capChildren.map((c) => (
                    <button key={c.id} type="button" onClick={() => p.onPickChild(c)} className="rounded-full border border-amber-400/50 px-2.5 py-0.5 text-[14px] text-amber-100 hover:bg-amber-400/20">
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {action}
            </div>
          ) : null}
          {plain.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-[14px] text-fg-muted">
              {plain.map((n, i) => (
                <li key={i}>{n.text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {p.expired && !r ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[15px] text-amber-200">
          <span>{fill(FIND_TEXT.saveExpired, {})}</span>
          <Button size="sm" onClick={p.onRunAgain}>
            {FIND_TEXT.runAgain}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const ERROR_FALLBACK = "The search failed. Try again.";

export function CapGate({ area, plan, trade, onChild, onContinue, onChange }: { area: ResolvedArea; plan: GatePlan; trade: string; onChild: (c: GateChild) => void; onContinue: () => void; onChange: () => void }) {
  const child = CHILD_KIND_WORDS[area.kind] ?? "part";
  return (
    <div className="space-y-3 p-4" data-testid="cap-gate">
      <p className="text-[17px] text-fg-heading">{fill(FIND_TEXT.gateTitle, { expected: formatInt(plan.expected), trade: tradePlural(trade, plan.expected), area: area.label, cap: formatInt(plan.cap) })}</p>
      {plan.units.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[15px] text-fg-muted">{fill(FIND_TEXT.gateChildren, { child })}</p>
          <div className="flex flex-wrap gap-1.5">
            {plan.units.map((u) => (
              <button key={u.id} type="button" data-testid="cap-child" onClick={() => onChild(u)} className="rounded-full border border-line px-3 py-1 text-[15px] text-fg-heading hover:border-accent-magenta hover:bg-accent-magenta/10">
                {u.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="primary" size="sm" data-testid="cap-continue" onClick={onContinue}>
          {fill(FIND_TEXT.gateContinue, { cap: formatInt(plan.cap) })}
        </Button>
        <Button size="sm" onClick={onChange}>
          {FIND_TEXT.gateChange}
        </Button>
      </div>
    </div>
  );
}
