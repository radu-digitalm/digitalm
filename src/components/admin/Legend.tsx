"use client";

// The map legend (docs/finder-ux-spec.md §5.3): the pin vocabulary, the
// outline and the status words, opened from the "?" button in the map corner.
import { useEffect, useRef, useState } from "react";
import { FIND_TEXT, LEGEND_TEXT } from "./wording";

function Pin({ fill, stroke, strokeWidth = 2, ring = false }: { fill: string; stroke: string; strokeWidth?: number; ring?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      {ring ? <circle cx="11" cy="11" r="9" fill="none" stroke="#ffffff" strokeWidth="3" /> : null}
      <circle cx="11" cy="11" r="7" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
}

const ROWS: { icon: React.ReactNode; text: string }[] = [
  { icon: <Pin fill="#ED1E79" stroke="#ED1E79" />, text: LEGEND_TEXT.pinWebsite },
  { icon: <Pin fill="transparent" stroke="#ED1E79" />, text: LEGEND_TEXT.pinNoWebsite },
  { icon: <Pin fill="#34d399" stroke="#34d399" />, text: LEGEND_TEXT.pinSaved },
  { icon: <Pin fill="rgba(160,168,180,0.4)" stroke="rgba(160,168,180,0.4)" />, text: LEGEND_TEXT.pinHidden },
  { icon: <Pin fill="#ED1E79" stroke="#fbbf24" />, text: LEGEND_TEXT.pinOutside },
  { icon: <Pin fill="#ED1E79" stroke="#ffffff" strokeWidth={3} />, text: LEGEND_TEXT.pinSelected },
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

export function Legend({ className = "" }: { className?: string }) {
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
      {open ? (
        <div className="mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface/95 p-4 text-[14px] text-fg shadow-2xl backdrop-blur">
          <p className="mb-2 text-[15px] text-fg-heading">{LEGEND_TEXT.title}</p>
          <ul className="space-y-1.5">
            {ROWS.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                {r.icon}
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
          <p className="mb-1 mt-3 text-[15px] text-fg-heading">{LEGEND_TEXT.statusTitle}</p>
          <ul className="space-y-1">
            {STATUS_ROWS.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
