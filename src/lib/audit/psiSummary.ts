// PageSpeed Insights body → PsiSummary (contract §7.3): the scalars the speed
// and seo_basics checks read, nothing else. Pure, relative imports only.
import type { PsiSummary } from "../crm/types.ts";

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
