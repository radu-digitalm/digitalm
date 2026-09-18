"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTRIES, PHONE_TEXT, guessCountry, validatePhone } from "@/lib/phone";
import type { Country, PhoneLang } from "@/lib/phone";

// Shared phone input: a searchable country picker (flag + dial code) plus the
// number. The parent form reads `dialcode` + `phoneNumber` from FormData, and
// can also read `phoneE164` (the normalised international form).
//
// The starting country comes from the browser itself — its time zone, then its
// languages — so a Quebec visitor on the French page does not silently file a
// 10-digit number under +33 (that happened, 17 Sep 2026). No IP lookup: the
// browser already knows, which keeps the privacy notice unchanged.

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
  const [sel, setSel] = useState<Country>(
    () => COUNTRIES.find((c) => c.dial === defaultDial) ?? COUNTRIES[0]!,
  );
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  // Pre-hydration guess from the dial the page was rendered with; the effect
  // below replaces it with what <html lang> actually says.
  const [lang, setLang] = useState<PhoneLang>(defaultDial === "+33" ? "fr" : "en");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialRef = useRef(defaultDial);

  // Mount only: server render and first client render must agree, so the guess
  // happens after hydration.
  useEffect(() => {
    try {
      setSel(
        guessCountry({
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          languages: navigator.languages,
          fallbackDial: dialRef.current,
        }),
      );
    } catch {
      /* exotic browser: keep the country the page was rendered with */
    }
    try {
      setLang(document.documentElement.lang.startsWith("fr") ? "fr" : "en");
    } catch {
      /* keep the pre-hydration guess */
    }
  }, []);

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

  // The contact form calls form.reset() after a successful send.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setValue("");
      setBlurred(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  // `setCustomValidity` alone only stops a form the browser validates itself.
  // The contact form carries `noValidate`, so an impossible number would still
  // be posted and stored (that is exactly the 17 Sep 2026 lead). Guard the
  // submit here, in the capture phase, before the form's own React handler.
  // A valid number falls straight through, so nothing changes where the
  // browser already blocks.
  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) return;
    const onSubmit = (e: Event) => {
      if (input.validity.valid) return;
      e.preventDefault();
      e.stopPropagation();
      setBlurred(true);
      input.reportValidity();
      input.focus();
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, []);

  const copy = PHONE_TEXT[lang];
  const check = validatePhone(value, sel);
  const message = check.ok ? "" : `${copy[check.reason]} ${copy.hint(sel)}`;
  const errorShown = blurred && message !== "";
  const hintShown = !errorShown && (focused || value.trim() === "");

  // Block submission with the browser's own validation, in whichever language
  // the page is in.
  useEffect(() => {
    inputRef.current?.setCustomValidity(message);
  }, [message]);

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(ql) ||
          c.dial.includes(ql) ||
          c.c.toLowerCase() === ql,
      )
    : COUNTRIES;

  function choose(country: Country) {
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
        <input type="hidden" name="phoneE164" value={check.ok ? check.e164 : ""} />
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
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setBlurred(true);
          }}
          aria-invalid={errorShown || undefined}
          aria-describedby={
            errorShown ? "phoneNumber-error" : hintShown ? "phoneNumber-hint" : undefined
          }
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
      {errorShown ? (
        <p id="phoneNumber-error" role="alert" className="mt-1.5 text-sm text-accent-soft">
          {message}
        </p>
      ) : hintShown ? (
        <p id="phoneNumber-hint" className="mt-1.5 text-sm text-fg-faint">
          {copy.hint(sel)}
        </p>
      ) : null}
    </div>
  );
}
