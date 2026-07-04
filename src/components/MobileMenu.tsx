"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import type { NavLink } from "@/content/types";
import { LanguageToggle } from "./LanguageToggle";

export function MobileMenu({
  locale,
  base,
  links,
  ctaLabel,
}: {
  locale: Locale;
  base: string;
  links: NavLink[];
  ctaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // Close on click/tap outside or Escape. (A fixed backdrop won't work here
  // because the header's backdrop-blur traps position:fixed descendants.)
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
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative md:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 text-fg-heading"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {open ? (
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open ? (
        <nav
          className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100dvh-6rem)] w-72 overflow-y-auto rounded-xl border border-white/10 bg-surface p-4 shadow-xl"
          aria-label="Mobile"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={`${base}${l.href}`}
              onClick={close}
              className="block rounded-md px-4 py-3.5 text-lg text-fg-muted transition-colors hover:bg-white/5 hover:text-fg-heading"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href={`${base}/book`}
            onClick={close}
            className="btn-primary mt-3 block px-4 py-3.5 text-center text-base"
          >
            {ctaLabel}
          </Link>
          <div className="mt-4 border-t border-white/10 pt-4">
            <LanguageToggle locale={locale} />
          </div>
        </nav>
      ) : null}
    </div>
  );
}
