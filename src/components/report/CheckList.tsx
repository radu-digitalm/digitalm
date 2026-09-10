import type { CheckStatus } from "@/lib/crm/types";
import { REPORT_UI, type ReportLocale } from "@/content/report";
import type { CheckRow } from "@/lib/report/findings";

// The ten checks, one row each. Every string comes from content/report.ts
// through findings.ts — nothing crawled is ever printed here.
const DOT: Record<CheckStatus, string> = {
  pass: "dot-pass bg-emerald-400",
  partial: "dot-partial bg-amber-400",
  fail: "dot-fail bg-accent",
  not_measured: "dot-none bg-line-strong",
};
const LABEL: Record<CheckStatus, string> = {
  pass: "text-emerald-300",
  partial: "text-amber-300",
  fail: "text-accent-soft",
  not_measured: "text-fg-faint",
};

export function CheckList({ rows, locale }: { rows: CheckRow[]; locale: ReportLocale }) {
  const ui = REPORT_UI[locale];
  return (
    <section className="mt-10" aria-labelledby="report-checks">
      <h2 id="report-checks" className="text-2xl">
        {ui.checksHeading}
      </h2>
      <ol className="card mt-4 divide-y divide-white/[0.07]">
        {rows.map((r) => (
          <li key={r.key} className="check-row grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 px-5 py-4">
            <span className={`mt-2 h-2.5 w-2.5 rounded-full ${DOT[r.status]}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-fg-heading">{r.name}</p>
              <p className="mt-0.5 text-sm text-fg-muted">{r.text}</p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-medium ${LABEL[r.status]}`}>{r.statusLabel}</p>
              <p className="font-mono text-xs text-fg-faint">{r.measured ? `${r.points}/${r.weight} ${ui.points}` : "—"}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
