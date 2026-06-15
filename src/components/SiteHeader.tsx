import Link from "next/link";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";

export function SiteHeader({ locale }: { locale: Locale }) {
  const c = getContent(locale);
  const base = `/${locale}`;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink/85 backdrop-blur-md">
      <div className="container-x flex h-20 items-center justify-between gap-4 md:h-24">
        <Link href={base} aria-label="Digital M" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-white.webp" alt="Digital M" className="h-12 w-auto md:h-16" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {c.nav.links.map((l) => (
            <Link
              key={l.href}
              href={`${base}${l.href}`}
              className="font-mono text-sm text-fg-muted transition-colors hover:text-fg-heading"
            >
              {l.label}
            </Link>
          ))}
          <LanguageToggle locale={locale} />
          <Link href={`${base}/contact`} className="btn-primary px-4 py-2 text-sm">
            {c.nav.cta}
          </Link>
        </nav>

        <details className="group relative md:hidden">
          <summary
            className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-white/10 text-fg-heading [&::-webkit-details-marker]:hidden"
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-white/10 bg-surface p-4 shadow-xl">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {c.nav.links.map((l) => (
                <Link
                  key={l.href}
                  href={`${base}${l.href}`}
                  className="rounded-md px-3 py-2 font-mono text-sm text-fg-muted hover:bg-white/5 hover:text-fg-heading"
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href={`${base}/contact`}
                className="btn-primary mt-2 px-3 py-2 text-center text-sm"
              >
                {c.nav.cta}
              </Link>
              <div className="mt-3 border-t border-white/10 pt-3">
                <LanguageToggle locale={locale} />
              </div>
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}
