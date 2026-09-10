// Placeholder for an empty list or an unavailable panel, with an optional action slot.
export function EmptyState({
  title,
  hint,
  action,
  className = "",
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card flex flex-col items-center gap-2 px-6 py-10 text-center ${className}`}>
      <p className="text-fg-heading">{title}</p>
      {hint ? <p className="max-w-md text-sm text-fg-muted">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
