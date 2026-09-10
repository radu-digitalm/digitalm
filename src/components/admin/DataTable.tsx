// Generic table for admin lists. No hooks, no client directive: usable from
// server pages and client panels alike. Wide tables scroll inside their own
// container so the page never scrolls sideways.
export type Column<T> = {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
  dense = false,
  rowClassName,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  empty?: React.ReactNode;
  dense?: boolean;
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
}) {
  const pad = dense ? "px-3 py-1.5" : "px-3 py-2.5";
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-faint">
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
              <tr key={rowKey(row, i)} className={`border-b border-line/60 last:border-0 hover:bg-surface-2/60 ${rowClassName?.(row) ?? ""}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`${pad} align-top ${ALIGN[c.align ?? "left"]} ${c.className ?? ""}`}>
                    {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
