// Per-provider daily counters (api_usage) — caps for audits, outreach emails,
// Google Places and the public geo APIs. Days are UTC dates; the Google cap is
// monthly so there is a month sum too.
import { enquiriesDb } from "@/lib/enquiries";

export function todayUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Count for `provider` on `day` (default today). */
export function apiUsage(provider: string, day = todayUtc()): number {
  const row = enquiriesDb().prepare("SELECT count FROM api_usage WHERE provider = ? AND day = ?").get(provider, day) as { count: number } | undefined;
  return row?.count ?? 0;
}

/** Add `n` (default 1) to today's counter. */
export function countApiUsage(provider: string, n = 1, day = todayUtc()): void {
  enquiriesDb()
    .prepare(
      "INSERT INTO api_usage (provider, day, count, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(provider, day) DO UPDATE SET count = count + excluded.count, updated_at = datetime('now')",
    )
    .run(provider, day, n);
}

/** Sum for a calendar month ("YYYY-MM", default this month, UTC). */
export function apiUsageMonth(provider: string, month = todayUtc().slice(0, 7)): number {
  const row = enquiriesDb()
    .prepare("SELECT COALESCE(SUM(count), 0) AS n FROM api_usage WHERE provider = ? AND day LIKE ? ESCAPE '\\'")
    .get(provider, `${month.replace(/[%_\\]/g, "")}-%`) as { n: number };
  return row.n;
}

/** Every provider's count for a day — the digest's "API counters" line. */
export function apiUsageForDay(day = todayUtc()): { provider: string; count: number }[] {
  return enquiriesDb().prepare("SELECT provider, count FROM api_usage WHERE day = ? ORDER BY provider").all(day) as { provider: string; count: number }[];
}
