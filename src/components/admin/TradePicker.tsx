"use client";

// The Trade combobox of the search bar (docs/finder-ux-spec.md §5.2): type to
// filter the 19 trades (English and French labels both match), last option
// "Other trade…" reveals the custom fields with plain labels.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, inputClass, labelClass } from "./Field";
import { Select } from "./Select";
import { FIND_TEXT } from "./wording";

export type TradeOption = { key: string; label: { fr: string; en: string } };
export type CustomTradeValue = { osmKey: string; osmValue: string; label: string; naf: string; sic: string };

export const CUSTOM_KEY = "custom";

/** Map categories in words → the map key they stand for. */
export const MAP_CATEGORY_OPTIONS = [
  { value: "shop", label: "shops" },
  { value: "craft", label: "services and crafts" },
  { value: "office", label: "offices" },
  { value: "tourism", label: "tourism" },
  { value: "leisure", label: "leisure" },
  { value: "healthcare", label: "health" },
  { value: "amenity", label: "amenities" },
];

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function TradePicker({
  trades,
  value,
  onChange,
  custom,
  onCustomChange,
  disabled = false,
  className = "",
}: {
  trades: TradeOption[];
  value: string;
  onChange: (key: string) => void;
  custom: CustomTradeValue;
  onCustomChange: (c: CustomTradeValue) => void;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const inputId = "category";
  const selectedLabel = value === CUSTOM_KEY ? FIND_TEXT.otherTrade : trades.find((t) => t.key === value)?.label.en ?? "";
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(selectedLabel);
  }, [selectedLabel]);

  const options = useMemo(() => {
    const q = fold(text.trim());
    const filtered = !q || q === fold(selectedLabel) ? trades : trades.filter((t) => fold(t.label.en).includes(q) || fold(t.label.fr).includes(q) || fold(t.key).includes(q));
    return [...filtered.map((t) => ({ key: t.key, label: t.label.en, sub: t.label.fr !== t.label.en ? t.label.fr : "" })), { key: CUSTOM_KEY, label: FIND_TEXT.otherTrade, sub: "" }];
  }, [text, trades, selectedLabel]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setText(selectedLabel);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, selectedLabel]);

  function choose(key: string) {
    onChange(key);
    setOpen(false);
    setText(key === CUSTOM_KEY ? FIND_TEXT.otherTrade : trades.find((t) => t.key === key)?.label.en ?? "");
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && options[active]) {
        e.preventDefault();
        choose(options[active].key);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setText(selectedLabel);
    }
  }

  return (
    <div ref={root} className={className}>
      <label htmlFor={inputId} className={labelClass}>
        {FIND_TEXT.tradeLabel}
      </label>
      <div className="relative">
        <input
          id={inputId}
          name="category"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].key}` : undefined}
          value={text}
          disabled={disabled}
          placeholder={FIND_TEXT.tradePlaceholder}
          autoComplete="off"
          className={inputClass}
          onFocus={() => {
            setOpen(true);
            setActive(Math.max(0, options.findIndex((o) => o.key === value)));
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        {open ? (
          <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
            {options.map((o, i) => (
              <li
                key={o.key}
                id={`${listId}-${o.key}`}
                role="option"
                aria-selected={o.key === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.key);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-[15px] ${i === active ? "bg-surface-3 text-fg-heading" : "text-fg"} ${o.key === CUSTOM_KEY ? "border-t border-line text-fg-muted" : ""}`}
              >
                <span>{o.label}</span>
                {o.sub ? <span className="text-[14px] text-fg-muted">{o.sub}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {value === CUSTOM_KEY ? (
        <div className="mt-3 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select label={FIND_TEXT.customCategory} name="osmKey" value={custom.osmKey} onChange={(e) => onCustomChange({ ...custom, osmKey: e.target.value })} options={MAP_CATEGORY_OPTIONS} />
          <Field label={FIND_TEXT.customValue} name="osmValue" value={custom.osmValue} onChange={(e) => onCustomChange({ ...custom, osmValue: e.target.value.toLowerCase() })} placeholder="tattoo" hint={FIND_TEXT.customValueHint} required />
          <Field label={FIND_TEXT.customName} name="label" value={custom.label} onChange={(e) => onCustomChange({ ...custom, label: e.target.value })} placeholder="Tattoo studio" />
          <Field label={FIND_TEXT.customNaf} name="naf" value={custom.naf} onChange={(e) => onCustomChange({ ...custom, naf: e.target.value.toUpperCase() })} placeholder="96.09Z" />
          <Field label={FIND_TEXT.customSic} name="sic" value={custom.sic} onChange={(e) => onCustomChange({ ...custom, sic: e.target.value })} placeholder="96090" />
        </div>
      ) : null}
    </div>
  );
}
