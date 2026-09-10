// Identifier allowlists (contract §0, §10): a sort or filter key from the
// query string may only ever select a value from a fixed table. A plain
// object lookup is not enough — `table["constructor"]` or `table["__proto__"]`
// resolves through Object.prototype and would interpolate native-code text
// into SQL. Own keys only, everything else falls back. No imports, so node
// --test loads it.

/** `table[key]` when `key` is an own property of the table, else `table[fallback]`. */
export function allowed<T>(table: Record<string, T>, key: string | null | undefined, fallback: string): T {
  if (typeof key === "string" && Object.hasOwn(table, key)) return table[key]!;
  return table[fallback]!;
}

/** The key itself when it is an own property of the table, else the fallback key. */
export function allowedKey(table: Record<string, unknown>, key: string | null | undefined, fallback: string): string {
  return typeof key === "string" && Object.hasOwn(table, key) ? key : fallback;
}
