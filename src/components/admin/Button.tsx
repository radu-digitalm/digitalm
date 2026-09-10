import type { ButtonHTMLAttributes } from "react";

// Tailwind-only buttons on the site's existing btn-primary / btn-ghost classes,
// plus a danger variant for destructive actions. Default type="button" so a
// stray click inside a form never submits it.
export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  danger: "rounded-lg border border-accent/50 bg-accent/10 font-medium text-accent-soft hover:bg-accent/20",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

/** Class string for links styled as buttons (`<a>` / `<Link>`). */
export function buttonClass(variant: ButtonVariant = "ghost", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap ${VARIANT[variant]} ${SIZE[size]} disabled:cursor-not-allowed disabled:opacity-60 ${extra}`;
}

export function Button({
  variant = "ghost",
  size = "md",
  loading = false,
  className = "",
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
