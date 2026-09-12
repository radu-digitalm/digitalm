"use client";

// The Area box with Google's place suggestions (docs/finder-google-spec.md
// §5.3): the Places UI Kit autocomplete element, created imperatively once the
// script is in (`ready`), so SSR and hydration always see the plain Field.
// The element's value is not readable: the typed text is captured from its
// composed `input` events and mirrored into form.area (the phone's collapsed
// bar and the Enter-without-picking path post that text as today). A pick
// (`gmp-select`) carries the place id only and the element clears its box, so
// the plain Field then shows the area the search resolved to ("Ariège,
// France") until the box is focused again. The plain Field is in force
// whenever the script failed, Google is off, the search runs, the ambiguity
// chooser is open, or no `input` event ever follows a keystroke (an element
// build that does not compose them) — exactly today's behaviour.
import { useEffect, useRef, useState } from "react";
import { Field, FieldFrame } from "./Field";
import { createPlacesElement, importLibrary, placeIdOk } from "./googleMaps";
import { FIND_TEXT } from "./wording";

export type GoogleAreaInputProps = {
  value: string;
  onChange: (v: string) => void;
  onSuggestion: (s: { placeId: string }) => void;
  /** Enter in the element without a pick: submit with the typed text, as the plain Field does. */
  onEnter?: () => void;
  disabled?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** The ambiguity chooser is open — keep the plain Field. */
  plain?: boolean;
};

/** A pick that lands within this window after Enter cancels the plain-text submit. */
const ENTER_GRACE_MS = 250;
/** No `input` event this long after a keystroke → the element does not compose them → plain Field. */
const INPUT_WATCHDOG_MS = 600;

export function GoogleAreaInput({ value, onChange, onSuggestion, onEnter, disabled = false, hint, error, plain = false }: GoogleAreaInputProps) {
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState(false);
  const [editing, setEditing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const lastTyped = useRef<string | null>(null);
  const handlers = useRef({ onChange, onSuggestion, onEnter });
  handlers.current = { onChange, onSuggestion, onEnter };

  useEffect(() => {
    let cancelled = false;
    importLibrary("places").then(
      () => {
        if (!cancelled) setReady(true);
      },
      () => {
        if (!cancelled) setBroken(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The element shows while the box is being typed in; the Field whenever the value came from elsewhere.
  // A search has started (the form is disabled): back to the plain field, which shows the text that
  // was submitted — the element cannot be given a value, so it would come back empty afterwards.
  useEffect(() => {
    if (disabled) setEditing(false);
  }, [disabled]);

  const canUseElement = ready && !broken && !disabled && !plain;
  const useElement = canUseElement && (editing || value === "");
  const editingAtMount = useRef(false);
  editingAtMount.current = editing;

  useEffect(() => {
    const host = box.current;
    if (!useElement || !host) return;
    const el = createPlacesElement("gmp-basic-place-autocomplete", {
      includedPrimaryTypes: ["(regions)"],
      requestedLanguage: "en",
      placeholder: FIND_TEXT.areaPlaceholder,
      name: "area",
      "attr:id": "area",
      "attr:class": "dm-garea",
    });
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let enterTimer: ReturnType<typeof setTimeout> | null = null;
    let sawInput = false;
    let typed = "";
    const onInput = (e: Event) => {
      sawInput = true;
      // The element is mounted for an empty box without `editing`; the first keystroke makes the
      // value non-empty and, without this, `useElement` flips and the element is unmounted mid-word.
      setEditing(true);
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      const target = (e.composedPath?.()[0] ?? null) as { value?: unknown } | null;
      let text: string | null = target && typeof target.value === "string" ? target.value : null;
      if (text === null) {
        const inner = el.shadowRoot?.querySelector("input");
        if (inner) text = inner.value;
      }
      if (text === null) {
        // A closed shadow root: rebuild the text from the event itself.
        const ie = e as InputEvent;
        if (typeof ie.inputType === "string" && ie.inputType.startsWith("delete")) typed = typed.slice(0, -1);
        else if (typeof ie.data === "string") typed += ie.data;
        text = typed;
      } else typed = text;
      lastTyped.current = text;
      handlers.current.onChange(text);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (enterTimer) clearTimeout(enterTimer);
        enterTimer = setTimeout(() => {
          enterTimer = null;
          handlers.current.onEnter?.();
        }, ENTER_GRACE_MS);
        return;
      }
      if ((e.key.length === 1 || e.key === "Backspace") && !sawInput && !watchdog) {
        watchdog = setTimeout(() => {
          watchdog = null;
          if (!sawInput) setBroken(true);
        }, INPUT_WATCHDOG_MS);
      }
    };
    const onSelect = (e: Event) => {
      if (enterTimer) {
        clearTimeout(enterTimer);
        enterTimer = null;
      }
      const id = (e as Event & { place?: { id?: unknown } }).place?.id;
      if (!placeIdOk(id)) return;
      setEditing(false);
      handlers.current.onSuggestion({ placeId: id });
    };
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKey);
    el.addEventListener("gmp-select", onSelect);
    host.replaceChildren(el);
    if (editingAtMount.current) {
      try {
        el.focus();
        el.shadowRoot?.querySelector("input")?.focus();
      } catch {
        /* focus is a courtesy */
      }
    }
    return () => {
      if (watchdog) clearTimeout(watchdog);
      if (enterTimer) clearTimeout(enterTimer);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("gmp-select", onSelect);
      el.remove();
    };
  }, [useElement]);

  if (!useElement) {
    return (
      <Field
        label={FIND_TEXT.areaLabel}
        name="area"
        value={value}
        onChange={(e) => {
          lastTyped.current = e.target.value;
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (canUseElement) {
            lastTyped.current = null;
            setEditing(true);
          }
        }}
        placeholder={FIND_TEXT.areaPlaceholder}
        hint={hint}
        error={error}
        autoComplete="off"
        maxLength={120}
        disabled={disabled}
        required
      />
    );
  }
  return (
    <FieldFrame label={FIND_TEXT.areaLabel} htmlFor="area" hint={hint} error={error}>
      <div ref={box} className="dm-garea-box" data-testid="area-suggestions" />
    </FieldFrame>
  );
}
