import { OPTOUT_PAGE } from "@/content/outreach";

// Unknown or mistyped opt-out token (contract §9): the INVALID LINK text in
// both languages — the language of the send is unknown here — with a 404.
export default function OptoutNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-6 py-20 text-center text-fg">
      <section className="w-full max-w-lg">
        <p className="font-mono text-sm text-fg-faint">404</p>
        <h1 className="mt-4 text-3xl md:text-4xl">
          {OPTOUT_PAGE.fr.title} · {OPTOUT_PAGE.en.title}
        </h1>
        <p lang="fr" className="mt-6 text-fg-muted">
          {OPTOUT_PAGE.fr.invalid}
        </p>
        <p lang="en" className="mt-3 text-fg-muted">
          {OPTOUT_PAGE.en.invalid}
        </p>
      </section>
    </main>
  );
}
