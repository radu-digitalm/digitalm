import Link from "next/link";
import { Nav } from "./Nav";
import { ToastProvider } from "./Toast";

// Admin chrome: top bar with the nav, a content column, the toast stack.
// Server component — it renders on every (gated) page; the gate itself is the
// page's requireAdmin() call, never this shell.
export function AdminShell({ subject, children }: { subject: string | null; children: React.ReactNode }) {
  return (
    <div lang="en" className="min-h-screen bg-ink text-fg">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-content items-center gap-6 px-6 py-3">
          <Link href="/admin" className="shrink-0 font-display text-fg-heading">
            Digital M <span className="text-fg-muted">· CRM</span>
          </Link>
          <Nav subject={subject} />
        </div>
      </header>
      <ToastProvider>
        <main id="main" className="mx-auto max-w-content px-6 py-8">
          {children}
        </main>
      </ToastProvider>
    </div>
  );
}
