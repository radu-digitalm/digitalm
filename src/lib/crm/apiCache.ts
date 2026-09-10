// JSON response cache in SQLite (api_cache): geocoding 30 d, Overpass /
// registers 24 h, PageSpeed 30 d, search results 24 h. Keys are
// "<provider>:<sha256(request)>" or a caller-chosen key like "search:42".
import { createHash } from "node:crypto";
import { enquiriesDb } from "@/lib/enquiries";
import { parseJson, sqlNow, toSql } from "@/lib/crm/db";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Deterministic key for a request description (pass objects with stable key order). */
export function cacheKey(provider: string, request: unknown): string {
  return `${provider}:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
}

export function cacheGet<T>(key: string): T | null {
  const row = enquiriesDb().prepare("SELECT payload FROM api_cache WHERE cache_key = ? AND expires_at > ?").get(key, sqlNow()) as
    | { payload: string }
    | undefined;
  if (!row) return null;
  return parseJson<T | null>(row.payload, null);
}

export function cacheSet(key: string, provider: string, payload: unknown, ttlMs: number): void {
  enquiriesDb()
    .prepare(
      "INSERT INTO api_cache (cache_key, provider, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET provider = excluded.provider, payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
    )
    .run(key, provider, JSON.stringify(payload ?? null), sqlNow(), toSql(new Date(Date.now() + ttlMs)));
}

export function cacheDelete(key: string): void {
  enquiriesDb().prepare("DELETE FROM api_cache WHERE cache_key = ?").run(key);
}

/** Read-through helper: `hit` tells callers whether a network call was made (usage counters). */
export async function cached<T>(provider: string, request: unknown, ttlMs: number, fetcher: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const key = cacheKey(provider, request);
  const existing = cacheGet<T>(key);
  if (existing !== null) return { value: existing, hit: true };
  const value = await fetcher();
  cacheSet(key, provider, value, ttlMs);
  return { value, hit: false };
}

/** Drop expired rows; returns how many went (the purge script calls this too). */
export function cachePurgeExpired(): number {
  return enquiriesDb().prepare("DELETE FROM api_cache WHERE expires_at <= ?").run(sqlNow()).changes;
}
