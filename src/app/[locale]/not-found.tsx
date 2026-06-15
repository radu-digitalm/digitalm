import Link from "next/link";

export default function NotFound() {
  return (
    <section className="container-x py-28 text-center">
      <p className="font-mono text-sm text-fg-faint">404</p>
      <h1 className="mt-4 text-3xl md:text-4xl">
        Page not found · Page introuvable
      </h1>
      <p className="mx-auto mt-4 max-w-md text-fg-muted">
        The page you&apos;re looking for isn&apos;t here. La page que vous
        cherchez n&apos;existe pas.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/en"
          className="rounded-lg bg-brand-gradient px-5 py-3 text-sm font-medium text-ink"
        >
          Home
        </Link>
        <Link
          href="/fr"
          className="rounded-lg border border-white/15 px-5 py-3 text-sm font-medium text-fg-heading hover:bg-white/5"
        >
          Accueil
        </Link>
      </div>
    </section>
  );
}
