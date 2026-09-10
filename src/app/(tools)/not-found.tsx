import Link from "next/link";

// Branded bilingual 404 for the tool routes — an expired or mistyped report /
// opt-out link lands here, so it speaks to prospects, not admins.
export default function ToolsNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-6 py-28 text-center">
      <section>
        <p className="font-mono text-sm text-fg-faint">404</p>
        <h1 className="mt-4 text-3xl md:text-4xl">Page introuvable · Page not found</h1>
        <p className="mx-auto mt-4 max-w-md text-fg-muted">
          Ce lien n&apos;est pas valide ou n&apos;existe plus. This link is not valid or no longer exists.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/fr" className="rounded-lg bg-brand-gradient px-5 py-3 text-sm font-medium text-ink">
            Accueil
          </Link>
          <Link
            href="/en"
            className="rounded-lg border border-white/15 px-5 py-3 text-sm font-medium text-fg-heading hover:bg-white/5"
          >
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}
