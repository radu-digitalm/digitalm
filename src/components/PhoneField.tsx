"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTRIES, PHONE_TEXT, guessCountry, validatePhone } from "@/lib/phone";
import type { Country, PhoneCheck, PhoneCopy, PhoneLang } from "@/lib/phone";

// Shared phone input: a searchable country picker (flag + dial code) plus the
// number. The parent form reads `dialcode` + `phoneNumber` from FormData, and
// can also read `phoneE164` (the normalised international form).
//
// The starting country comes from the browser itself — its time zone, then its
// languages — so a Quebec visitor on the French page does not silently file a
// 10-digit number under +33 (that happened, 17 Sep 2026). No IP lookup: the
// browser already knows, which keeps the privacy notice unchanged.
//
// What the form ends up posting: both call sites assemble the phone as
// `dialcode` + " " + `phoneNumber`, so those two fields have to be right on
// their own. On submit the number is rewritten to its national digits (the
// trunk 0 gone: "06 30 91 28 44" becomes "630912844", posted as
// "+33 630912844"), and a number typed in full for a country the picker does
// not carry blanks `dialcode` so nothing is prefixed to it.

function messageFor(check: PhoneCheck, country: Country, copy: PhoneCopy): string {
  if (check.ok) return "";
  if (check.reason === "empty") return `${copy.empty} ${copy.hint(country)}`;
  return `${copy[check.reason]} ${copy.hint(country)} ${copy.intl}`;
}

/** What `phoneNumber` should carry once the number is known to be valid. */
function fieldValue(check: Extract<PhoneCheck, { ok: true }>): string {
  return check.foreign ? check.e164 : check.national;
}

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
    // Text typed before hydration is in the DOM but not in React state, and
    // the re-render below would wipe it. Take it over first.
    const typed = inputRef.current?.value;
    if (typed) setValue(typed);
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
  // submit here, in the capture phase, before the form's own React handler:
  // a bad number never reaches the network, and a good one is normalised in
  // place so the `dialcode` + `phoneNumber` the handler reads are already the
  // international form. Reading `input.value` rather than the state also
  // covers text typed before hydration.
  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) return;
    const onSubmit = (e: Event) => {
      const check = validatePhone(input.value, sel);
      if (check.ok) {
        const next = fieldValue(check);
        if (next !== input.value) {
          input.value = next;
          setValue(next);
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setValue(input.value);
      setBlurred(true);
      input.setCustomValidity(messageFor(check, sel, PHONE_TEXT[lang]));
      // reportValidity focuses the field itself; focusing again here would
      // dismiss the bubble it just opened on some browsers.
      input.reportValidity();
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [sel, lang]);

  const copy = PHONE_TEXT[lang];
  const check = validatePhone(value, sel);
  const message = messageFor(check, sel, copy);
  const errorShown = blurred && message !== "";
  // A number typed in full for a country the picker does not carry: say so,
  // otherwise the flag sitting beside it reads as a contradiction.
  const foreignShown = !errorShown && check.ok && check.foreign;
  const hintShown = !errorShown && !foreignShown && (focused || value.trim() === "");

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
        {/* A number carrying its own country code must not get a second one. */}
        <input
          type="hidden"
          name="dialcode"
          value={check.ok && check.foreign ? "" : sel.dial}
        />
        <input type="hidden" name="phoneE164" value={check.ok ? check.e164 : ""} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={copy.country}
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
            errorShown
              ? "phoneNumber-error"
              : hintShown || foreignShown
                ? "phoneNumber-hint"
                : undefined
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
              placeholder={copy.search}
              aria-label={copy.searchLabel}
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
      ) : foreignShown ? (
        <p id="phoneNumber-hint" className="mt-1.5 text-sm text-fg-faint">
          {copy.foreignOk}
        </p>
      ) : hintShown ? (
        <p id="phoneNumber-hint" className="mt-1.5 text-sm text-fg-faint">
          {copy.hint(sel)}
        </p>
      ) : null}
    </div>
  );
}
