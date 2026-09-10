"use client";

// Small toast stack for the admin UI: `const toast = useToast(); toast.push("Saved 7 · 5 audits queued")`.
// Mounted once by AdminShell; toasts dismiss themselves after five seconds.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastKind = "info" | "good" | "bad";
export type ToastItem = { id: number; message: string; kind: ToastKind };

type ToastApi = { push: (message: string, kind?: ToastKind) => void; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);

const KIND_CLASS: Record<ToastKind, string> = {
  info: "border-line-strong bg-surface-2 text-fg-heading",
  good: "border-emerald-500/40 bg-surface-2 text-emerald-200",
  bad: "border-accent/50 bg-surface-2 text-accent-soft",
};

export function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  return (
    <div role="status" className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${KIND_CLASS[item.kind]}`}>
      <span className="flex-1">{item.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="text-fg-muted hover:text-fg-heading">
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-4), { id, message, kind }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast item={t} onClose={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Outside a provider (tests, stray usage) it degrades to console output. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? { push: (m) => console.log("toast:", m), dismiss: () => undefined };
}
