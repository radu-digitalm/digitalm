import type { InputHTMLAttributes } from "react";

// Labelled text input. Field / Select / Textarea share one look: label above,
// optional hint below, error in accent. `name` doubles as the id when no id is given.
export const inputClass =
  "w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const labelClass = "mb-1.5 block text-sm text-fg-muted";

export function FieldFrame({
  label,
  htmlFor,
  hint,
  error,
  className = "",
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-accent-soft">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-fg-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  id,
  name,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode }) {
  const inputId = id ?? name;
  return (
    <FieldFrame label={label} htmlFor={inputId} hint={hint} error={error} className={className}>
      <input id={inputId} name={name} className={inputClass} aria-invalid={error ? true : undefined} {...rest} />
    </FieldFrame>
  );
}
