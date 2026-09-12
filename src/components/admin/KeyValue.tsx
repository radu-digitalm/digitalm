// Definition list for facts (register block, lead details, send preview).
// Values are rendered as React nodes — text by default, so foreign data is escaped.
// Rows without a value are not rendered (`hideEmpty`, default) — no "—" placeholders
// anywhere in the admin (docs/finder-ux-spec.md §6.1).
export type KeyValueItem = { label: React.ReactNode; value: React.ReactNode; muted?: boolean };

function isEmpty(v: React.ReactNode): boolean {
  return v === null || v === undefined || v === "" || v === false;
}

export function KeyValue({ items, className = "", columns = 1, hideEmpty = true }: { items: KeyValueItem[]; className?: string; columns?: 1 | 2; hideEmpty?: boolean }) {
  const shown = hideEmpty ? items.filter((it) => !isEmpty(it.value)) : items;
  if (shown.length === 0) return null;
  return (
    <dl className={`grid gap-x-6 gap-y-2.5 ${columns === 2 ? "sm:grid-cols-2" : ""} ${className}`}>
      {shown.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(7rem,30%)_1fr] gap-3">
          <dt className="text-[15px] text-fg-muted">{it.label}</dt>
          <dd className={`min-w-0 break-words text-[16px] ${it.muted ? "text-fg-muted" : "text-fg-heading"}`}>{isEmpty(it.value) ? <span className="text-fg-muted">not known</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
