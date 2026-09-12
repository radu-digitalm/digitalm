"use client";

// The search bar of the finder (docs/finder-ux-spec.md §5.2): Area input,
// Trade combobox, Sources popover and the Search / Stop button. Controlled by
// FindWorkspace, which owns the value so it can re-post with a pick, a cap
// confirmation or a child area.
import { useEffect, useId, useRef, useState } from "react";
import type { DiscoverySource } from "@/lib/crm/types";
import { AreaInput } from "./AreaInput";
import { Button } from "./Button";
import type { Candidate } from "./finderApi";
import { TradePicker, type CustomTradeValue, type TradeOption } from "./TradePicker";
import { FIND_TEXT, SOURCE_WORDS, fill } from "./wording";

export type FormValue = { area: string; categoryKey: string; custom: CustomTradeValue; sources: DiscoverySource[] };

export const EMPTY_CUSTOM: CustomTradeValue = { osmKey: "shop", osmValue: "", label: "", naf: "", sic: "" };

export function defaultSources(companiesHouseOn: boolean): DiscoverySource[] {
  return companiesHouseOn ? ["osm", "fr_register", "companies_house"] : ["osm", "fr_register"];
}

function SourcesPopover({ value, onChange, companiesHouseOn, googleOn, disabled }: { value: DiscoverySource[]; onChange: (v: DiscoverySource[]) => void; companiesHouseOn: boolean; googleOn: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const rows: { id: DiscoverySource; label: string; off: string | null }[] = [
    { id: "osm", label: FIND_TEXT.sourceOsm, off: null },
    { id: "fr_register", label: FIND_TEXT.sourceRegister, off: null },
    { id: "companies_house", label: FIND_TEXT.sourceCompaniesHouse, off: companiesHouseOn ? null : FIND_TEXT.sourceNeedsKey },
    { id: "google", label: FIND_TEXT.sourceGoogle, off: googleOn ? null : FIND_TEXT.sourceSwitchedOff },
  ];
  const summary = value.map((s) => SOURCE_WORDS[s].replace("French company register", "French register")).join(" + ") || "none";

  function toggle(s: DiscoverySource) {
    onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  }

  return (
    <div ref={root} className="relative">
      <Button size="md" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} data-testid="sources" disabled={disabled} className="max-w-full">
        <span className="truncate">{fill(FIND_TEXT.sourcesButton, { list: summary })}</span>
      </Button>
      {open ? (
        <div id={id} className="absolute left-0 top-full z-40 mt-1 w-[24rem] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-3 shadow-xl">
          <p className="mb-2 text-[16px] text-fg-heading">{FIND_TEXT.sourcesTitle}</p>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <label key={r.id} className={`flex items-start gap-2 text-[16px] ${r.off ? "text-fg-muted" : "text-fg-heading"}`}>
                <input type="checkbox" className="mt-0.5" checked={!r.off && value.includes(r.id)} disabled={!!r.off} onChange={() => toggle(r.id)} />
                <span>
                  {r.label}
                  {r.off ? <span className="text-fg-muted"> — {r.off}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FindForm({
  trades,
  value,
  onChange,
  onSubmit,
  onStop,
  running,
  resolving,
  candidates,
  onPick,
  companiesHouseOn,
  googleOn,
  error,
  compact = false,
}: {
  trades: TradeOption[];
  value: FormValue;
  onChange: (v: FormValue) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  resolving: boolean;
  candidates: Candidate[] | null;
  onPick: (c: Candidate) => void;
  companiesHouseOn: boolean;
  googleOn: boolean;
  error: string | null;
  /** Once a search exists the onboarding lines go, so the map and list get the height. */
  compact?: boolean;
}) {
  const busy = running || resolving;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (running) onStop();
        else onSubmit();
      }}
      noValidate
      className="space-y-2"
      aria-label={FIND_TEXT.title}
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_auto] lg:items-start">
        <AreaInput value={value.area} onChange={(area) => onChange({ ...value, area })} candidates={candidates} onPick={onPick} disabled={busy} showHint={!compact} />
        <TradePicker trades={trades} value={value.categoryKey} onChange={(categoryKey) => onChange({ ...value, categoryKey })} custom={value.custom} onCustomChange={(custom) => onChange({ ...value, custom })} disabled={busy} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:col-span-2 lg:contents">
          <div className="min-w-0 lg:pt-[29px]">
            <SourcesPopover value={value.sources} onChange={(sources) => onChange({ ...value, sources })} companiesHouseOn={companiesHouseOn} googleOn={googleOn} disabled={busy} />
          </div>
          <div className="lg:pt-[29px]">
            <Button type="submit" variant={running ? "danger" : "primary"} loading={resolving} data-testid="find-submit" className="min-w-[7rem]">
              {running ? FIND_TEXT.stop : FIND_TEXT.search}
            </Button>
          </div>
        </div>
      </div>
      {compact && !error ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {compact ? null : <p className="text-[16px] text-fg-muted">{FIND_TEXT.helper}</p>}
          {error ? (
            <p role="alert" className="text-[16px] text-accent-soft">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </form>
  );
}
