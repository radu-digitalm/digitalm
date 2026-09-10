// PageSpeed Insights v5, mobile strategy (contract §7.3): one GET on the
// fixed PSI host through crm/http.ts (https, allow-listed origin), 90 s,
// reused for 30 days per origin, reduced to PsiSummary before anything is
// stored. Any failure — our timeout, a dead host, a PSI/Lighthouse error —
// comes back as `timedOut: true`, which the speed check scores as partial.
// The API key travels in the query string and is never logged.
import { HOSTS, HttpError, fetchJson } from "@/lib/crm/http";
import { DAY_MS, cacheGet, cacheKey, cacheSet } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import type { PsiSummary } from "@/lib/crm/types";

export const PSI_TIMEOUT_MS = 90_000;
export const PSI_TTL_MS = 30 * DAY_MS;

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
    audits?: Record<string, { score?: number | null; numericValue?: number | null } | undefined>;
  };
};

function score01(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null;
}

function auditPass(a: { score?: number | null } | undefined): boolean | null {
  if (!a || typeof a.score !== "number") return null;
  return a.score === 1;
}

export function timedOutSummary(fetchedAt = new Date().toISOString()): PsiSummary {
  return { performance: null, seo: null, lcpMs: null, cls: null, viewport: null, title: null, description: null, fetchedAt, timedOut: true };
}

/** Keep the scalars the checks read; everything else in the PSI body is dropped here. */
export function summarisePsi(data: unknown, fetchedAt = new Date().toISOString()): PsiSummary {
  const lr = (data as PsiResponse | null)?.lighthouseResult;
  if (!lr || typeof lr !== "object") return timedOutSummary(fetchedAt);
  const cats = lr.categories ?? {};
  const audits = lr.audits ?? {};
  const performance = score01(cats.performance?.score);
  if (performance === null) return timedOutSummary(fetchedAt);
  const lcp = audits["largest-contentful-paint"]?.numericValue;
  const cls = audits["cumulative-layout-shift"]?.numericValue;
  return {
    performance,
    seo: score01(cats.seo?.score),
    lcpMs: typeof lcp === "number" && Number.isFinite(lcp) ? Math.round(lcp) : null,
    cls: typeof cls === "number" && Number.isFinite(cls) ? Math.round(cls * 1000) / 1000 : null,
    viewport: auditPass(audits.viewport),
    title: auditPass(audits["document-title"]),
    description: auditPass(audits["meta-description"]),
    fetchedAt,
    timedOut: false,
  };
}

/** Request URL (with the key when set) — never log the result of this function. */
export function psiRequestUrl(url: string): string {
  const u = new URL(HOSTS.pagespeed);
  u.searchParams.set("url", url);
  u.searchParams.set("strategy", "mobile");
  u.searchParams.append("category", "performance");
  u.searchParams.append("category", "seo");
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key) u.searchParams.set("key", key);
  return u.toString();
}

/**
 * PSI summary for `url`: from the 30-day cache by origin, else one network
 * call (counted under api_usage "pagespeed"). Never throws.
 */
export async function runPagespeed(url: string, opts: { signal?: AbortSignal; log?: (m: string) => void } = {}): Promise<PsiSummary> {
  const log = opts.log ?? (() => undefined);
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return timedOutSummary();
  }
  const key = cacheKey("pagespeed", { origin });
  const cachedSummary = cacheGet<PsiSummary>(key);
  if (cachedSummary && cachedSummary.performance !== null) {
    log(`pagespeed: cached (${cachedSummary.fetchedAt})`);
    return cachedSummary;
  }
  countApiUsage("pagespeed");
  const fetchedAt = new Date().toISOString();
  try {
    const { data } = await fetchJson<unknown>(psiRequestUrl(url), { timeoutMs: PSI_TIMEOUT_MS, signal: opts.signal });
    const summary = summarisePsi(data, fetchedAt);
    if (!summary.timedOut) cacheSet(key, "pagespeed", summary, PSI_TTL_MS);
    log(`pagespeed: perf ${summary.performance ?? "—"} seo ${summary.seo ?? "—"}`);
    return summary;
  } catch (e) {
    // Timeouts and PSI errors are not cached: the next audit tries again.
    log(`pagespeed: ${e instanceof HttpError ? e.code : "failed"} → partial`);
    return timedOutSummary(fetchedAt);
  }
}
