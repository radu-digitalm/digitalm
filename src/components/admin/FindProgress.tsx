"use client";

// Status line, progress bar and banners of the finder (docs/finder-ux-spec.md
// §5.6) plus the over-cap gate panel (CapGate, rendered in the list pane).
// Every sentence comes from wording.ts; the bar and its sentence come from
// progressModel.ts (pure, tested); notes arrive as text from the server.
// The line re-renders every second while a search runs so "searching for
// 12 s" and the soft ETA tick.
import { useEffect, useState } from "react";
import { isTerminal, type Alternative, type GateChild, type GatePlan, type ResolvedArea, type SearchResultV2 } from "./finderApi";
import { Button } from "./Button";
import { formatInt } from "./format";
import { doneText, progressFraction, resolvedText, runningText, unitsDone } from "./progressModel";
import { AREA_KIND_WORDS, CHILD_KIND_WORDS, CHILD_KIND_WORDS_PLURAL, FIND_TEXT, fill } from "./wording";

export { progressFraction } from "./progressModel";

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

/** Banner notes get the amber box; `duplicates_removed` is folded into the finished line; the rest go under "Details". */
const BANNER_CODES = new Set(["capped", "units_failed", "register_failed", "interrupted", "expired", "time_limit", "unit_truncated"]);
const INLINE_CODES = new Set(["duplicates_removed"]);

/** A clock that ticks once a second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

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
  const now = useNow(running);

  const resolvedLine = area ? resolvedText(area, AREA_KIND_WORDS[area.kind] ?? area.kind) : null;
  // The estimate is a line of its own only while the search runs; once finished the real count is the only number shown.
  const multiUnit = (r?.progress.units.length ?? 0) > 1;
  const estimateLine = area && running ? (expected !== null ? fill(FIND_TEXT.estimate, { n: formatInt(expected), trade: tradePlural(trade || "business", expected) }) : multiUnit ? FIND_TEXT.estimateUnknown : "") : "";

  const alternatives = p.start?.alternatives ?? r?.alternatives ?? [];
  const notes = r?.notes ?? [];
  const banners = notes.filter((n) => BANNER_CODES.has(n.code));
  const plain = notes.filter((n) => !BANNER_CODES.has(n.code) && !INLINE_CODES.has(n.code));

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

  const fraction = r ? progressFraction(r, now) : null;
  const valueNow = fraction === null ? 0 : Math.round(fraction * 100);
  const liveText = r ? runningText(r, now) : "";

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
        <p className="text-[15px] text-fg-muted">
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
          <p className="text-[15px] text-fg-heading" data-testid="find-running">
            {liveText}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={valueNow} aria-label={liveText}>
            <div className={fraction === null ? "dm-bar-indeterminate h-full bg-accent-magenta" : "h-full bg-accent-magenta transition-[width] duration-700 ease-linear"} style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
          </div>
        </div>
      ) : running && !r ? (
        <div>
          <p className="text-[15px] text-fg-heading">{FIND_TEXT.searchingOsmOne}…</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-label={FIND_TEXT.searchingOsmOne}>
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
                  <span className="text-[15px]">{FIND_TEXT.searchDepartment}</span>
                  {p.capChildren.map((c) => (
                    <button key={c.id} type="button" onClick={() => p.onPickChild(c)} className="rounded-full border border-amber-400/50 px-2.5 py-0.5 text-[15px] text-amber-100 hover:bg-amber-400/20">
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {action}
            </div>
          ) : null}
          {plain.length > 0 ? (
            <details className="text-[15px]" data-testid="find-notes">
              <summary className="cursor-pointer text-fg-muted">{fill(FIND_TEXT.notesDetails, { n: plain.length })}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-fg-muted">
                {plain.map((n, i) => (
                  <li key={i}>{n.text}</li>
                ))}
              </ul>
            </details>
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

/**
 * The over-cap gate (§2.6): the decision first — continue with the nearest
 * N or change the area — then the real administrative children by name,
 * A–Z, as one-click searches. Never internal grid cells: when the area has
 * no children to offer, it says so and points at the Area box.
 */
export function CapGate({ area, plan, trade, onChild, onContinue, onChange }: { area: ResolvedArea; plan: GatePlan; trade: string; onChild: (c: GateChild) => void; onContinue: () => void; onChange: () => void }) {
  const child = CHILD_KIND_WORDS[area.kind] ?? "part";
  const children = CHILD_KIND_WORDS_PLURAL[area.kind] ?? "smaller areas";
  return (
    <div className="space-y-4 p-4" data-testid="cap-gate">
      <p className="text-[17px] text-fg-heading">
        {plan.expected === null
          ? fill(FIND_TEXT.gateTitleUnknown, { area: area.label, cap: formatInt(plan.cap) })
          : fill(FIND_TEXT.gateTitle, { expected: formatInt(plan.expected), trade: tradePlural(trade, plan.expected), area: area.label, cap: formatInt(plan.cap) })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" data-testid="cap-continue" onClick={onContinue}>
          {fill(FIND_TEXT.gateContinue, { cap: formatInt(plan.cap) })}
        </Button>
        <Button size="sm" onClick={onChange}>
          {FIND_TEXT.gateChange}
        </Button>
      </div>
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
      ) : (
        <p className="text-[15px] text-fg-muted">{fill(FIND_TEXT.gateNoChildren, { area: area.label, children })}</p>
      )}
    </div>
  );
}
