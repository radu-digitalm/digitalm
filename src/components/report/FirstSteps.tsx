import { REPORT_UI, type ReportLocale } from "@/content/report";
import type { FirstStep } from "@/lib/report/findings";

// "What we would do first": up to three lines, each a /pme package label with
// its price and the one-sentence action. No fits → the all-good line.
export function FirstSteps({ steps, locale }: { steps: FirstStep[]; locale: ReportLocale }) {
  const ui = REPORT_UI[locale];
  return (
    <section className="mt-10" aria-labelledby="report-first-steps">
      <h2 id="report-first-steps" className="text-2xl">
        {ui.firstStepsHeading}
      </h2>
      {steps.length ? (
        <>
          <p className="mt-1 text-sm text-fg-muted">{ui.firstStepsIntro}</p>
          <ol className="mt-4 grid gap-3">
            {steps.map((s, i) => (
              <li key={`${s.pkg}-${i}`} className="check-row card p-5">
                <p className="text-fg-heading">{s.label}</p>
                <p className="mt-1 text-sm text-fg-muted">{s.action}</p>
                {s.why ? <p className="mt-2 text-xs text-fg-faint">{s.why}</p> : null}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="card mt-4 p-5 text-fg-muted">{ui.allGood}</p>
      )}
    </section>
  );
}
