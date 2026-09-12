"use client";

// The map legend (docs/finder-ux-spec.md §5.3): the pin vocabulary, the
// outline and the status words, opened from the "?" button in the map corner.
// The panel is positioned under the button (the button never moves); on the
// phone it opens as a bottom sheet with its own scroll and a Close button.
// With the Google map (docs/finder-google-spec.md §5.4) one more pin — blue,
// on Google only — and one line saying Google data is shown by Google's own
// panels, with the outlined Google Maps logo (the panel sits over the map).
import { useEffect, useRef, useState } from "react";
import { GoogleAttribution } from "./GoogleAttribution";
import { FIND_TEXT, GOOGLE_TEXT, LEGEND_TEXT } from "./wording";

function Pin({ fill, stroke, strokeWidth = 2, ring = false }: { fill: string; stroke: string; strokeWidth?: number; ring?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      {ring ? <circle cx="11" cy="11" r="9" fill="none" stroke="#ffffff" strokeWidth="3" /> : null}
      <circle cx="11" cy="11" r="7" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
}

type Row = { icon: React.ReactNode; text: React.ReactNode };

const PIN_ROWS: Row[] = [
  { icon: <Pin fill="#ED1E79" stroke="#ED1E79" />, text: LEGEND_TEXT.pinWebsite },
  { icon: <Pin fill="transparent" stroke="#ED1E79" />, text: LEGEND_TEXT.pinNoWebsite },
  { icon: <Pin fill="#34d399" stroke="#34d399" />, text: LEGEND_TEXT.pinSaved },
  { icon: <Pin fill="rgba(160,168,180,0.4)" stroke="rgba(160,168,180,0.4)" />, text: LEGEND_TEXT.pinHidden },
  { icon: <Pin fill="#ED1E79" stroke="#fbbf24" />, text: LEGEND_TEXT.pinOutside },
  { icon: <Pin fill="#ED1E79" stroke="#ffffff" strokeWidth={3} />, text: LEGEND_TEXT.pinSelected },
];

const GOOGLE_PIN_ROW: Row = { icon: <Pin fill="#3B82F6" stroke="#3B82F6" />, text: GOOGLE_TEXT.legendPin };

const MAP_ROWS: Row[] = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <rect x="3" y="3" width="16" height="16" fill="rgba(241,90,36,0.08)" stroke="#F15A24" strokeWidth="2" strokeDasharray="4 3" />
      </svg>
    ),
    text: LEGEND_TEXT.outline,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <circle cx="6" cy="11" r="4" fill="#34d399" />
        <circle cx="16" cy="11" r="4" fill="#ef4444" />
      </svg>
    ),
    text: LEGEND_TEXT.units,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <circle cx="11" cy="11" r="10" fill="#1B2230" stroke="#ED1E79" strokeWidth="2" />
        <text x="11" y="15" textAnchor="middle" fontSize="10" fill="#f4f6fa">
          12
        </text>
      </svg>
    ),
    text: LEGEND_TEXT.cluster,
  },
];

const STATUS_ROWS = [LEGEND_TEXT.statusSaved, LEGEND_TEXT.statusNotListed, LEGEND_TEXT.statusClosed, LEGEND_TEXT.statusChain, LEGEND_TEXT.statusOutside];

export function Legend({ className = "", phone = false, google = false }: { className?: string; phone?: boolean; google?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  // Desktop: two columns (pins · outline, dots, discs and the words) so the whole legend fits beside the map without scrolling.
  const pinRows = google ? [...PIN_ROWS, GOOGLE_PIN_ROW] : PIN_ROWS;
  const list = (rows: Row[]) => (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-2">
          {r.icon}
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
  const words = (
    <>
      <p className="mb-1 mt-3 text-[16px] text-fg-heading">{LEGEND_TEXT.statusTitle}</p>
      <ul className="space-y-1">
        {STATUS_ROWS.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {google ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-1 text-fg-muted" data-testid="legend-google">
          <span>{GOOGLE_TEXT.legendData}</span>
          <GoogleAttribution onMap />
        </p>
      ) : null}
    </>
  );
  const body = phone ? (
    <>
      <p className="mb-2 text-[16px] text-fg-heading">{LEGEND_TEXT.title}</p>
      {list([...pinRows, ...MAP_ROWS])}
      {words}
    </>
  ) : (
    <>
      <p className="mb-2 text-[16px] text-fg-heading">{LEGEND_TEXT.title}</p>
      <div className="grid grid-cols-2 gap-x-6">
        <div>{list(pinRows)}</div>
        <div>
          {list(MAP_ROWS)}
          {words}
        </div>
      </div>
    </>
  );

  return (
    <div ref={root} className={`absolute right-2 top-2 z-[1001] ${className}`}>
      <button
        type="button"
        aria-label={FIND_TEXT.legend}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/95 text-[16px] font-medium text-fg-heading shadow hover:bg-surface-2"
      >
        ?
      </button>
      {open && phone ? (
        <div role="dialog" aria-label={LEGEND_TEXT.title} data-testid="legend-panel" className="fixed inset-x-0 bottom-0 z-[1002] max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pb-6 pt-3 text-[15px] text-fg shadow-2xl">
          <div className="mb-2 flex items-center justify-end">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-1 text-[15px] text-fg-heading hover:bg-surface-2">
              {FIND_TEXT.close}
            </button>
          </div>
          {body}
        </div>
      ) : open ? (
        <div role="dialog" aria-label={LEGEND_TEXT.title} data-testid="legend-panel" className="absolute right-0 top-11 max-h-[min(80vh,40rem)] w-[44rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line bg-surface/95 p-4 text-[15px] text-fg shadow-2xl backdrop-blur [scrollbar-width:thin]">
          {body}
        </div>
      ) : null}
    </div>
  );
}
