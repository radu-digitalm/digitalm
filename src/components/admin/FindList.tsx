"use client";

// The list pane of the finder (docs/finder-ux-spec.md §5.4): summary header,
// filter chips, search-within, sort, rows (pages of 200), bulk save and the
// attribution footer. Rows are keyboard-navigable (↑/↓ move, Enter opens the
// card, Space ticks). Every foreign value renders as text; the whole row
// opens the card — the website is plain text here and a link in the card.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { rowStatus, savable, type ResultRow, type SearchResultV2 } from "./finderApi";
import { Button } from "./Button";
import { inputClass } from "./Field";
import { domainOf, formatInt, townLine } from "./format";
import { bothCount, summaryText } from "./progressModel";
import { ATTRIBUTION_TEXT, FIND_TEXT, STATUS_WORDS, fill } from "./wording";

export type Chip = "savable" | "website" | "no_website" | "phone" | "email" | "register" | "saved" | "not_listed" | "hidden";
export type SortKey = "nearest" | "complete" | "town" | "name";

export const CHIP_LABEL: Record<Chip, string> = {
  savable: FIND_TEXT.chipSavable,
  website: FIND_TEXT.chipWebsite,
  no_website: FIND_TEXT.chipNoWebsite,
  phone: FIND_TEXT.chipPhone,
  email: FIND_TEXT.chipEmail,
  register: FIND_TEXT.chipRegister,
  saved: FIND_TEXT.chipSaved,
  not_listed: FIND_TEXT.chipNotListed,
  hidden: FIND_TEXT.chipHidden,
};

/** The chips that reveal rows kept out of the way by default (off → those rows are not listed at all). */
export const REVEAL_CHIPS: readonly Chip[] = ["not_listed", "hidden"];

/** Always visible; the other chips sit behind "More filters" so the row never scrolls sideways. */
export const PRIMARY_CHIPS: readonly Chip[] = ["savable", "website", "no_website"];

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "nearest", label: FIND_TEXT.sortNearest },
  { value: "complete", label: FIND_TEXT.sortComplete },
  { value: "town", label: FIND_TEXT.sortTown },
  { value: "name", label: FIND_TEXT.sortName },
];

export const PAGE = 200;

export type FindListProps = {
  result: SearchResultV2;
  rows: ResultRow[];
  counts: Record<Chip, number>;
  chips: Set<Chip>;
  onToggleChip: (c: Chip) => void;
  text: string;
  onText: (v: string) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  followMap: boolean;
  onFollowMap: (v: boolean) => void;
  showRegisterChip: boolean;
  selectedKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
  picked: Set<string>;
  onTogglePick: (key: string) => void;
  onSaveTicked: () => void;
  saving: boolean;
  shown: number;
  onShowMore: () => void;
  onUndoDismiss: (key: string) => void;
  rowRefs: MutableRefObject<Map<string, HTMLElement>>;
  running: boolean;
  /** Rendered under the rows (past searches). */
  footer?: React.ReactNode;
  /** Phone: the sheet header already shows the count — keep only the per-source line. */
  compactHeader?: boolean;
  className?: string;
};

function StatusWord({ r, area }: { r: ResultRow; area: string }) {
  const s = rowStatus(r);
  if (s === "saved" && r.alreadySaved)
    return (
      <Link href={`/admin/prospects/${r.alreadySaved.prospectId}`} onClick={(e) => e.stopPropagation()} className="link-accent whitespace-nowrap text-[16px]" data-testid="row-status">
        {STATUS_WORDS.saved} · <span className="font-mono text-[15px]">{r.alreadySaved.reference}</span>
      </Link>
    );
  if (s === "not_listed")
    return (
      <span className="text-[16px] text-fg-muted" data-testid="row-status">
        {STATUS_WORDS.not_listed}
      </span>
    );
  if (s === "closed")
    return (
      <span className="text-[16px] text-fg-muted" data-testid="row-status">
        {STATUS_WORDS.closed}
      </span>
    );
  if (s === "outside")
    return (
      <span className="text-[16px] text-amber-300" data-testid="row-status" title={fill(FIND_TEXT.outsideArea, { area })}>
        {STATUS_WORDS.outside}
      </span>
    );
  if (s === "chain")
    return (
      <span className="text-[16px] text-fg-muted" data-testid="row-status">
        {STATUS_WORDS.chain}
      </span>
    );
  if (s === "hidden")
    return (
      <span className="text-[16px] text-fg-muted" data-testid="row-status">
        {STATUS_WORDS.hidden}
      </span>
    );
  return <span data-testid="row-status" />;
}

export function FindList(p: FindListProps) {
  const { result, rows } = p;
  const area = result.area;
  const listEl = useRef<HTMLDivElement>(null);
  const rootEl = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(true);
  const [moreFilters, setMoreFilters] = useState(false);
  const visible = rows.slice(0, p.shown);

  // Under ~620 px the row is two lines (name · status / town · phone · website); wider panes get four columns.
  useEffect(() => {
    const el = rootEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.getBoundingClientRect().width < 620));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isCountry = area.kind === "country";
  const savableKeys = useMemo(() => rows.filter(savable).map((r) => r.key), [rows]);
  const pickedCount = useMemo(() => [...p.picked].filter((k) => savableKeys.includes(k)).length, [p.picked, savableKeys]);

  // Selected row scrolls into view (pin click → list follows).
  useEffect(() => {
    if (!p.selectedKey) return;
    const el = p.rowRefs.current.get(p.selectedKey);
    el?.scrollIntoView({ block: "nearest" });
  }, [p.selectedKey, p.rowRefs]);

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = p.selectedKey ? visible.findIndex((r) => r.key === p.selectedKey) : -1;
    const next = e.key === "ArrowDown" ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
    const row = visible[next];
    if (row) {
      p.rowRefs.current.get(row.key)?.focus();
      p.onHover(row.key);
    }
  }

  const summary = summaryText(result);
  const hasRegister = result.sources.includes("fr_register") && area.countryCode === "FR";
  // The sources split is shown here and nowhere else; without the register the title already says it all.
  const perSource = hasRegister ? fill(p.running ? FIND_TEXT.perSourceRunning : FIND_TEXT.perSource, { onMap: formatInt(result.perSource.osm ?? 0), inRegister: formatInt(result.perSource.fr_register ?? 0), inBoth: formatInt(bothCount(result)) }) : "";
  const savableLine = fill(FIND_TEXT.summarySavable, { n: formatInt(p.counts.savable) });

  const chips: Chip[] = ["savable", "website", "no_website", "phone", "email", ...(p.showRegisterChip ? (["register"] as Chip[]) : []), "saved", ...(hasRegister ? (["not_listed"] as Chip[]) : []), "hidden"];
  const secondaryChips = chips.filter((c) => !PRIMARY_CHIPS.includes(c));
  // An active filter is never hidden behind the toggle.
  const showAllChips = moreFilters || secondaryChips.some((c) => p.chips.has(c));
  const shownChips = showAllChips ? chips : chips.filter((c) => PRIMARY_CHIPS.includes(c));

  // Town groups (sticky headers) when sorted by town.
  const groups = useMemo(() => {
    if (p.sort !== "town") return null;
    const out: { town: string; rows: ResultRow[] }[] = [];
    for (const r of visible) {
      const town = r.city?.trim() || FIND_TEXT.townUnknown;
      const last = out[out.length - 1];
      if (last && last.town === town) last.rows.push(r);
      else out.push({ town, rows: [r] });
    }
    return out;
  }, [visible, p.sort]);

  const countByTown = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const t = r.city?.trim() || FIND_TEXT.townUnknown;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  function renderRow(r: ResultRow) {
    const selected = r.key === p.selectedKey;
    const canSave = savable(r);
    const second = r.addressLine?.trim() ? r.addressLine : r.cityApprox && r.city ? fill(FIND_TEXT.nearTown, { town: r.city }) : "";
    const town = townLine(r.postcode, r.city);
    const showCountry = isCountry || (r.countryCode && r.countryCode !== area.countryCode);
    const undoButton = r.hidden ? (
      <button
        type="button"
        className="rounded-md border border-line px-2 py-0.5 text-[15px] text-fg-heading hover:bg-surface-2"
        onClick={(e) => {
          e.stopPropagation();
          p.onUndoDismiss(r.key);
        }}
      >
        {FIND_TEXT.undo}
      </button>
    ) : null;
    return (
      <div
        key={r.key}
        ref={(el) => {
          if (el) p.rowRefs.current.set(r.key, el);
          else p.rowRefs.current.delete(r.key);
        }}
        role="button"
        tabIndex={0}
        data-testid="find-row"
        data-key={r.key}
        aria-pressed={selected}
        onClick={() => p.onSelect(r.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            p.onSelect(r.key);
          } else if (e.key === " " && canSave) {
            e.preventDefault();
            p.onTogglePick(r.key);
          }
        }}
        onMouseEnter={() => p.onHover(r.key)}
        onMouseLeave={() => p.onHover(null)}
        onFocus={() => p.onHover(r.key)}
        className={`grid min-h-[48px] cursor-pointer grid-cols-[28px_minmax(0,1fr)] gap-x-3 border-b border-line/60 px-3 py-2.5 text-left outline-none transition-colors focus-visible:bg-surface-2 ${
          selected ? "bg-surface-3" : "hover:bg-surface-2/70"
        } ${r.hidden ? "opacity-60" : ""}`}
      >
        <div className="pt-0.5">
          {canSave ? (
            <input
              type="checkbox"
              aria-label={`Tick ${r.name}`}
              checked={p.picked.has(r.key)}
              onChange={() => p.onTogglePick(r.key)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>
        {narrow ? (
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[17px] text-fg-heading" data-testid="row-name">
                {r.name}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusWord r={r} area={area.label} />
                {undoButton}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 text-[16px] text-fg">
              {town || (showCountry && r.countryName) ? (
                <span className="min-w-0 truncate">
                  {town}
                  {showCountry && r.countryName ? <span className="text-fg-muted">{town ? ", " : ""}{r.countryName}</span> : null}
                </span>
              ) : null}
              {r.phone ? <span className="whitespace-nowrap">{r.phone}</span> : null}
              {r.website ? (
                <span className="min-w-0 truncate text-fg-muted" data-testid="row-site">
                  {domainOf(r.website)}
                </span>
              ) : null}
            </div>
            {second ? <div className="truncate text-[15px] text-fg-muted">{second}</div> : null}
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
            <div className="min-w-0">
              <div className="truncate text-[17px] text-fg-heading" data-testid="row-name">
                {r.name}
              </div>
              {second ? <div className="truncate text-[15px] text-fg-muted">{second}</div> : null}
            </div>
            <div className="min-w-0 truncate text-[16px] text-fg">
              {town}
              {showCountry && r.countryName ? <span className="text-fg-muted">{town ? ", " : ""}{r.countryName}</span> : null}
            </div>
            <div className="min-w-0 text-[16px] text-fg">
              {r.phone ? <div className="whitespace-nowrap">{r.phone}</div> : null}
              {r.website ? (
                <div className="truncate text-fg-muted" data-testid="row-site">
                  {domainOf(r.website)}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              <StatusWord r={r} area={area.label} />
              {undoButton}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootEl} className={`flex min-h-0 flex-col ${p.className ?? ""}`} data-testid="find-list">
      <div className="shrink-0 space-y-2 border-b border-line px-3 pb-2 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div data-testid="find-summary">
            {p.compactHeader ? null : <div className="text-[19px] text-fg-heading">{summary}</div>}
            <div className="text-[16px] text-fg-muted">
              <span className="text-fg">{savableLine}</span>
              {perSource ? ` · ${perSource}` : null}
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={p.onSaveTicked} disabled={pickedCount === 0} loading={p.saving}>
            {fill(FIND_TEXT.saveTicked, { n: pickedCount })}
          </Button>
        </div>
        {/* The chips wrap — never a sideways scroll: three primary ones, the rest behind "More filters". */}
        <div role="group" aria-label={FIND_TEXT.filtersLabel} className="flex flex-wrap gap-1.5">
          {shownChips.map((c) => {
            const on = p.chips.has(c);
            const reveal = REVEAL_CHIPS.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => p.onToggleChip(c)}
                title={reveal ? `${CHIP_LABEL[c]} — off by default; switch on to list them (at the bottom)` : undefined}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-[16px] transition-colors ${on ? "border-accent-magenta bg-accent-magenta/15 text-fg-heading" : "border-line text-fg-muted hover:border-line-strong hover:text-fg-heading"}`}
              >
                {CHIP_LABEL[c]} <span className="text-fg-muted">({formatInt(p.counts[c])})</span>
              </button>
            );
          })}
          {secondaryChips.length > 0 ? (
            <button type="button" aria-expanded={showAllChips} onClick={() => setMoreFilters(!showAllChips)} data-testid="more-filters" className="whitespace-nowrap rounded-full px-2 py-1 text-[16px] text-fg-muted underline-offset-2 hover:text-fg-heading hover:underline">
              {showAllChips ? FIND_TEXT.fewerFilters : fill(FIND_TEXT.moreFilters, { n: secondaryChips.length })}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={p.text} onChange={(e) => p.onText(e.target.value)} placeholder={FIND_TEXT.filterPlaceholder} aria-label={FIND_TEXT.filterPlaceholder} className={`${inputClass} min-w-[10rem] flex-1`} />
          <label className="flex items-center gap-2 text-[16px] text-fg-muted" title={FIND_TEXT.sortHint}>
            <span>{FIND_TEXT.sortLabel}</span>
            <select name="sort" value={p.sort} onChange={(e) => p.onSort(e.target.value as SortKey)} className={`${inputClass} w-auto`}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[16px] text-fg-muted">
            <input type="checkbox" checked={p.followMap} onChange={(e) => p.onFollowMap(e.target.checked)} />
            {FIND_TEXT.followMap}
          </label>
        </div>
      </div>

      <div ref={listEl} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKey}>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[16px] text-fg-muted">{p.running ? FIND_TEXT.searchingOsmOne + "…" : "Nothing matches these filters."}</p>
        ) : groups ? (
          groups.map((g) => (
            <div key={g.town}>
              <div className="sticky top-0 z-10 border-b border-line bg-surface px-3 py-1.5 text-[15px] font-medium text-fg-heading">
                {g.town} ({countByTown.get(g.town) ?? g.rows.length})
              </div>
              {g.rows.map(renderRow)}
            </div>
          ))
        ) : (
          visible.map(renderRow)
        )}
        {rows.length > p.shown ? (
          <div className="p-3 text-center">
            <Button size="sm" onClick={p.onShowMore}>
              {fill(FIND_TEXT.showMore, { n: Math.min(PAGE, rows.length - p.shown) })}
            </Button>
          </div>
        ) : null}
        {p.footer}
        <p className="px-3 py-3 text-[15px] text-fg-muted">{ATTRIBUTION_TEXT}</p>
      </div>
    </div>
  );
}
