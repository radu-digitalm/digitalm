import type { TextareaHTMLAttributes } from "react";
import { FieldFrame, inputClass } from "./Field";

// Labelled <textarea> (draft subject/body, notes, call scripts).
export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  name,
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode }) {
  const areaId = id ?? name;
  return (
    <FieldFrame label={label} htmlFor={areaId} hint={hint} error={error} className={className}>
      <textarea id={areaId} name={name} rows={rows} className={`${inputClass} leading-relaxed`} aria-invalid={error ? true : undefined} {...rest} />
    </FieldFrame>
  );
}
