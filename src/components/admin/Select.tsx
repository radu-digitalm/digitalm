import type { SelectHTMLAttributes } from "react";
import { FieldFrame, inputClass } from "./Field";

export type SelectOption = { value: string; label: string; disabled?: boolean };

// Labelled <select>; options as { value, label } so callers never build markup.
export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  id,
  name,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  options: SelectOption[];
  placeholder?: string;
}) {
  const selectId = id ?? name;
  return (
    <FieldFrame label={label} htmlFor={selectId} hint={hint} error={error} className={className}>
      <select id={selectId} name={name} className={inputClass} aria-invalid={error ? true : undefined} {...rest}>
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}
