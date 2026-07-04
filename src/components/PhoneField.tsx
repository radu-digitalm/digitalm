"use client";

import { useEffect, useRef, useState } from "react";

// Shared phone input: a searchable country picker (flag + dial code) plus the
// number. The parent form reads `dialcode` + `phoneNumber` from FormData.

const COUNTRIES: { c: string; dial: string; flag: string; name: string }[] = [
  { c: "FR", dial: "+33", flag: "🇫🇷", name: "France" },
  { c: "GB", dial: "+44", flag: "🇬🇧", name: "United Kingdom" },
  { c: "US", dial: "+1", flag: "🇺🇸", name: "United States" },
  { c: "CA", dial: "+1", flag: "🇨🇦", name: "Canada" },
  { c: "IE", dial: "+353", flag: "🇮🇪", name: "Ireland" },
  { c: "BE", dial: "+32", flag: "🇧🇪", name: "Belgium" },
  { c: "CH", dial: "+41", flag: "🇨🇭", name: "Switzerland" },
  { c: "LU", dial: "+352", flag: "🇱🇺", name: "Luxembourg" },
  { c: "DE", dial: "+49", flag: "🇩🇪", name: "Germany" },
  { c: "ES", dial: "+34", flag: "🇪🇸", name: "Spain" },
  { c: "IT", dial: "+39", flag: "🇮🇹", name: "Italy" },
  { c: "NL", dial: "+31", flag: "🇳🇱", name: "Netherlands" },
  { c: "PT", dial: "+351", flag: "🇵🇹", name: "Portugal" },
  { c: "AT", dial: "+43", flag: "🇦🇹", name: "Austria" },
  { c: "DK", dial: "+45", flag: "🇩🇰", name: "Denmark" },
  { c: "SE", dial: "+46", flag: "🇸🇪", name: "Sweden" },
  { c: "NO", dial: "+47", flag: "🇳🇴", name: "Norway" },
  { c: "FI", dial: "+358", flag: "🇫🇮", name: "Finland" },
  { c: "PL", dial: "+48", flag: "🇵🇱", name: "Poland" },
  { c: "CZ", dial: "+420", flag: "🇨🇿", name: "Czechia" },
  { c: "RO", dial: "+40", flag: "🇷🇴", name: "Romania" },
  { c: "GR", dial: "+30", flag: "🇬🇷", name: "Greece" },
  { c: "HU", dial: "+36", flag: "🇭🇺", name: "Hungary" },
  { c: "AU", dial: "+61", flag: "🇦🇺", name: "Australia" },
  { c: "NZ", dial: "+64", flag: "🇳🇿", name: "New Zealand" },
  { c: "AE", dial: "+971", flag: "🇦🇪", name: "UAE" },
  { c: "SA", dial: "+966", flag: "🇸🇦", name: "Saudi Arabia" },
  { c: "MA", dial: "+212", flag: "🇲🇦", name: "Morocco" },
  { c: "TN", dial: "+216", flag: "🇹🇳", name: "Tunisia" },
  { c: "DZ", dial: "+213", flag: "🇩🇿", name: "Algeria" },
  { c: "ZA", dial: "+27", flag: "🇿🇦", name: "South Africa" },
  { c: "SG", dial: "+65", flag: "🇸🇬", name: "Singapore" },
];

export function PhoneField({
  label,
  defaultDial = "+33",
  fieldClass,
  labelClass,
}: {
  label: string;
  defaultDial?: string;
  fieldClass: string;
  labelClass: string;
}) {
  const [sel, setSel] = useState(
    () => COUNTRIES.find((c) => c.dial === defaultDial) ?? COUNTRIES[0]!,
  );
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    // Don't auto-focus the search on touch devices — it pops the keyboard over
    // the country list. Fine-pointer (desktop) still gets focus for typing.
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(ql) ||
          c.dial.includes(ql) ||
          c.c.toLowerCase() === ql,
      )
    : COUNTRIES;

  function choose(country: (typeof COUNTRIES)[number]) {
    setSel(country);
    setOpen(false);
    setQ("");
  }

  return (
    <div>
      <label htmlFor="phoneNumber" className={labelClass}>
        {label} <span className="text-accent">*</span>
      </label>
      <div ref={ref} className="relative flex gap-2">
        <input type="hidden" name="dialcode" value={sel.dial} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Country code"
          className={`${fieldClass} !w-28 flex shrink-0 items-center justify-between gap-1`}
        >
          <span>
            {sel.flag} {sel.dial}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="opacity-60">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          required
          autoComplete="tel-national"
          className={`${fieldClass} !w-auto min-w-0 flex-1`}
        />

        {open ? (
          <div className="absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-white/10 bg-surface shadow-xl">
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered[0]) choose(filtered[0]);
                }
              }}
              placeholder="Search…"
              aria-label="Search countries"
              className="w-full border-b border-white/10 bg-surface-2 px-3 py-2 text-base text-fg-heading placeholder:text-fg-faint focus:outline-none"
            />
            <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
              {filtered.map((c) => (
                <li key={c.c}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="flex min-h-[2.75rem] w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-fg-muted transition-colors hover:bg-white/5 hover:text-fg-heading"
                  >
                    <span>{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="font-mono text-xs text-fg-faint">{c.dial}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-fg-faint">—</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
