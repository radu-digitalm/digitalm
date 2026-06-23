import Link from "next/link";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";
import { MobileMenu } from "./MobileMenu";

export function SiteHeader({ locale }: { locale: Locale }) {
  const c = getContent(locale);
  const base = `/${locale}`;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink/85 backdrop-blur-md">
      <div className="container-x flex h-20 items-center justify-between gap-4 md:h-24">
        <Link href={base} aria-label="Digital M" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-white.webp" alt="Digital M" width={1920} height={721} className="h-12 w-auto md:h-16" />
        </Link>

        <nav className="hidden items-center gap-6 md:flex lg:gap-8" aria-label="Primary">
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
          <Link href={`${base}/book`} className="btn-primary px-4 py-2 text-sm">
            {c.nav.cta}
          </Link>
        </nav>

        <MobileMenu locale={locale} base={base} links={c.nav.links} ctaLabel={c.nav.cta} />
      </div>
    </header>
  );
}
