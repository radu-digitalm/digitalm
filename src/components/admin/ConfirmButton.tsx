"use client";

// Two-step destructive action: first click arms the button ("Confirm?") for
// four seconds, the second click runs `onConfirm`. No modal, no portal.
import { useEffect, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

export function ConfirmButton({
  label,
  confirmLabel = "Confirm?",
  onConfirm,
  variant = "danger",
  size = "md",
  disabled = false,
  loading = false,
  className,
}: {
  label: React.ReactNode;
  confirmLabel?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function click() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    await onConfirm();
  }

  return (
    <Button variant={armed ? "danger" : variant} size={size} disabled={disabled} loading={loading} onClick={click} className={className} aria-pressed={armed}>
      {armed ? confirmLabel : label}
    </Button>
  );
}
