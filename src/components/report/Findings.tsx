import { REPORT_UI, type ReportLocale } from "@/content/report";
import type { CheckRow } from "@/lib/report/findings";

// "The three points that matter most" — the audit's top checks in plain words.
// Hidden when everything passes (the all-good line is shown by FirstSteps).
export function Findings({ rows, locale }: { rows: CheckRow[]; locale: ReportLocale }) {
  if (!rows.length) return null;
  const ui = REPORT_UI[locale];
  return (
    <section className="mt-10" aria-labelledby="report-findings">
      <h2 id="report-findings" className="text-2xl">
        {ui.findingsHeading}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{ui.findingsIntro}</p>
      <ol className="mt-4 grid gap-3">
        {rows.map((r, i) => (
          <li key={r.key} className="check-row card flex gap-4 p-5">
            <span className="font-display text-3xl leading-none text-accent-soft" aria-hidden="true">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-fg-heading">{r.name}</p>
              <p className="mt-1 text-sm text-fg-muted">{r.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
