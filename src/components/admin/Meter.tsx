// 0–100 score bar coloured by grade: A ≥ 75 green, B 50–74 amber, C < 50 red.
// `grade` may be passed explicitly (from audits.grade) or derived from the value.
export type Grade = "A" | "B" | "C";

export function gradeFor(score: number): Grade {
  return score >= 75 ? "A" : score >= 50 ? "B" : "C";
}

const GRADE_BAR: Record<Grade, string> = {
  A: "bg-emerald-400",
  B: "bg-amber-400",
  C: "bg-accent",
};
const GRADE_TEXT: Record<Grade, string> = {
  A: "text-emerald-300",
  B: "text-amber-300",
  C: "text-accent-soft",
};

export function Meter({
  value,
  grade,
  label,
  className = "",
}: {
  value: number | null | undefined;
  grade?: Grade | null;
  label?: React.ReactNode;
  className?: string;
}) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  const g = grade ?? (n === null ? null : gradeFor(n));
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        {label ? <span className="text-sm text-fg-muted">{label}</span> : <span />}
        <span className={`font-mono text-sm ${g ? GRADE_TEXT[g] : "text-fg-faint"}`}>
          {n === null ? "—" : `${n} / 100`}
          {g ? <span className="ml-2 rounded border border-current px-1.5 text-xs">{g}</span> : null}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={n ?? undefined}
        aria-valuetext={n === null ? "not measured" : `${n} out of 100, grade ${g}`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className={`h-full rounded-full transition-[width] ${g ? GRADE_BAR[g] : "bg-line-strong"}`} style={{ width: `${n ?? 0}%` }} />
      </div>
    </div>
  );
}
