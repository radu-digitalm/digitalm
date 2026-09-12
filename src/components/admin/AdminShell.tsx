import Link from "next/link";
import { Nav } from "./Nav";
import { ToastProvider } from "./Toast";

// Admin chrome: top bar with the nav, a content column, the toast stack.
// Server component — it renders on every (gated) page; the gate itself is the
// page's requireAdmin() call, never this shell. Base type 15 px (16 px from xl),
// and a page whose root carries `find-wide` (the finder) opts out of the
// 1180 px column through the `has-[]` rule below — no JS, no flash.
export function AdminShell({ subject, children }: { subject: string | null; children: React.ReactNode }) {
  return (
    <div lang="en" className="admin-root min-h-screen bg-ink text-[15px] leading-relaxed text-fg xl:text-base">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-content items-center gap-4 px-4 py-2.5 sm:gap-6 sm:px-6">
          <Link href="/admin" className="shrink-0 font-display text-fg-heading">
            Digital M <span className="text-fg-muted">· CRM</span>
          </Link>
          <Nav subject={subject} />
        </div>
      </header>
      <ToastProvider>
        <main id="main" className="mx-auto max-w-content px-4 py-6 has-[.find-wide]:!max-w-none has-[.find-wide]:!px-4 has-[.find-wide]:!py-3 sm:px-6 sm:py-8">
          {children}
        </main>
      </ToastProvider>
    </div>
  );
}
