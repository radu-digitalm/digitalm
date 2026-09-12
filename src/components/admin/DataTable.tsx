// Generic table for admin lists. No hooks, no client directive: usable from
// server pages and client panels alike. Wide tables scroll inside their own
// container so the page never scrolls sideways; with `cards` each row is also
// rendered as a card under 768 px (label + value pairs from the headers).
export type Column<T> = {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  /** Card mode: hide the label (the value speaks for itself, e.g. the name cell). */
  cardLabel?: false | string;
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

function cell<T>(c: Column<T>, row: T, i: number): React.ReactNode {
  return c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? "");
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
  dense = false,
  rowClassName,
  caption,
  minWidth = "40rem",
  cards = false,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  empty?: React.ReactNode;
  dense?: boolean;
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
  /** Minimum table width before the container scrolls sideways. */
  minWidth?: string;
  /** Render rows as cards under 768 px. */
  cards?: boolean;
  /** Whole-row click (client components only); the row also gets a pointer cursor. */
  onRowClick?: (row: T) => void;
}) {
  const pad = dense ? "px-3 py-2" : "px-3 py-2.5";
  const table = (
    <div className={`card ${cards ? "hidden md:block" : ""}`} style={{ overflowX: "auto" }}>
      <table className="w-full text-[16px]" style={{ minWidth }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line text-[15px] font-medium uppercase tracking-wide text-fg-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`${pad} font-medium ${ALIGN[c.align ?? "left"]} ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={`${pad} py-8 text-center text-fg-muted`}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`min-h-[44px] border-b border-line/60 last:border-0 hover:bg-surface-2/60 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${pad} align-top ${ALIGN[c.align ?? "left"]} ${c.className ?? ""}`}>
                    {cell(c, row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
  if (!cards) return table;
  return (
    <>
      {table}
      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.length === 0 ? (
          <li className="card px-4 py-8 text-center text-fg-muted">{empty}</li>
        ) : (
          rows.map((row, i) => (
            <li key={rowKey(row, i)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`card space-y-2 p-4 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}>
              {columns.map((c) => {
                const value = cell(c, row, i);
                if (value === null || value === undefined || value === "") return null;
                const label = c.cardLabel === false ? null : c.cardLabel ?? (typeof c.header === "string" ? c.header : null);
                return (
                  <div key={c.key} className={label ? "grid grid-cols-[minmax(6rem,32%)_1fr] gap-3" : ""}>
                    {label ? <div className="text-[15px] text-fg-muted">{label}</div> : null}
                    <div className="min-w-0 break-words">{value}</div>
                  </div>
                );
              })}
            </li>
          ))
        )}
      </ul>
    </>
  );
}
