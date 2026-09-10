// Definition list for facts (register block, lead details, send preview).
// Values are rendered as React nodes — text by default, so foreign data is escaped.
export type KeyValueItem = { label: React.ReactNode; value: React.ReactNode; muted?: boolean };

export function KeyValue({ items, className = "", columns = 1 }: { items: KeyValueItem[]; className?: string; columns?: 1 | 2 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-2 text-sm ${columns === 2 ? "sm:grid-cols-2" : ""} ${className}`}>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(7rem,30%)_1fr] gap-3">
          <dt className="text-fg-faint">{it.label}</dt>
          <dd className={`min-w-0 break-words ${it.muted ? "text-fg-muted" : "text-fg-heading"}`}>
            {it.value === null || it.value === undefined || it.value === "" ? <span className="text-fg-faint">—</span> : it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
