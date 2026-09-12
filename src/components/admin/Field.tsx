import type { InputHTMLAttributes } from "react";

// Labelled text input. Field / Select / Textarea share one look: label above,
// optional hint below, error in accent. `name` doubles as the id when no id is given.
// Sizes per docs/finder-ux-spec.md §6.1: label 15 px, input 15–16 px, hint 14 px.
export const inputClass =
  "w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-[16px] xl:text-base text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const labelClass = "mb-1.5 block text-[16px] text-fg-muted";
export const hintClass = "mt-1 text-[15px] text-fg-muted";
export const errorClass = "mt-1 text-[15px] text-accent-soft";

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
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : hint ? (
        <p className={hintClass}>{hint}</p>
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
