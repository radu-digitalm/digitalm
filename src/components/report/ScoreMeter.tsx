import { REPORT_UI, type ReportLocale } from "@/content/report";

// Score out of 100 with the grade, for the prospect's page. Server component,
// text nodes only. Colours follow the admin Meter: A green, B amber, C accent.
const GRADE_TEXT = { A: "text-emerald-300", B: "text-amber-300", C: "text-accent-soft" } as const;
const GRADE_BAR = { A: "bg-emerald-400", B: "bg-amber-400", C: "bg-accent" } as const;

export function ScoreMeter({ score, grade, measured, locale }: { score: number | null; grade: "A" | "B" | "C" | null; measured: number; locale: ReportLocale }) {
  const ui = REPORT_UI[locale];
  const n = score === null ? null : Math.max(0, Math.min(100, Math.round(score)));
  const g = grade ?? (n === null ? null : n >= 75 ? "A" : n >= 50 ? "B" : "C");
  return (
    <section className="card mt-8 p-6" aria-label={ui.scoreLabel}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{ui.scoreLabel}</p>
          <p className="mt-2 font-display text-5xl text-fg-heading">
            {n === null ? "—" : n}
            <span className="text-2xl text-fg-muted"> / 100</span>
          </p>
        </div>
        {g ? (
          <div className="text-right">
            <p className="eyebrow">{ui.gradeLabel}</p>
            <p className={`mt-2 font-display text-5xl ${GRADE_TEXT[g]}`}>{g}</p>
          </div>
        ) : null}
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={n ?? undefined}
        className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className={`meter-fill h-full rounded-full ${g ? GRADE_BAR[g] : "bg-line-strong"}`} style={{ width: `${n ?? 0}%` }} />
      </div>
      <p className="mt-3 text-sm text-fg-muted">{ui.scoreExplainer.replace("{n}", String(measured))}</p>
    </section>
  );
}
