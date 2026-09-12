// Status pill. Variants: neutral | good | warn | bad | info (contract §4).
// Plain words only (docs/finder-ux-spec.md §6.3); `title` carries the sentence.
export type BadgeVariant = "neutral" | "good" | "warn" | "bad" | "info";

const VARIANT: Record<BadgeVariant, string> = {
  neutral: "border-line-strong bg-surface-2 text-fg-muted",
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-accent/50 bg-accent/10 text-accent-soft",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

export function Badge({
  variant = "neutral",
  children,
  title,
  className = "",
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[14px] font-medium leading-tight ${VARIANT[variant]} ${className}`}>
      {children}
    </span>
  );
}
