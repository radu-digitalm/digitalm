import Link from "next/link";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";
import { LOCAL_LINKS } from "@/lib/localBusiness";

const YEAR = 2026;

export function SiteFooter({ locale }: { locale: Locale }) {
  const c = getContent(locale);
  const base = `/${locale}`;

  return (
    <footer className="mt-24 border-t border-white/[0.07]">
      <div className="container-x grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-white.webp" alt="Digital M" width={1920} height={721} className="h-16 w-auto" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-muted">
            {c.footer.tagline}
          </p>
        </div>

        <div>
          <h2 className="eyebrow">{c.footer.contactHeading}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a className="link-accent" href={`mailto:${c.footer.email}`}>
                {c.footer.email}
              </a>
            </li>
            <li>
              <a className="text-fg-muted transition-colors hover:text-fg-heading" href="tel:+33412120909">
                04 12 12 09 09
              </a>
            </li>
            <li>
              <a
                className="text-fg-muted transition-colors hover:text-fg-heading"
                href={c.footer.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {c.footer.whatsappText}
              </a>
            </li>
            <li>
              <a
                className="text-fg-muted transition-colors hover:text-fg-heading"
                href="https://www.linkedin.com/company/digitalm-eu"
                target="_blank"
                rel="noopener noreferrer"
              >
                LinkedIn
              </a>
            </li>
            <li>
              <Link className="link-accent" href={`${base}/diagnostic`}>
                {locale === "fr" ? "Check-up numérique gratuit" : "Free digital check-up"}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="eyebrow">{c.footer.legalHeading}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {c.footer.legalLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={`${base}${l.href}`}
                  className="text-fg-muted transition-colors hover:text-fg-heading"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <a
            href="https://techbehemoths.com/company/digital-m"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Digital M — TechBehemoths Trusted Agency 2025"
            className="mt-3 inline-block rounded-lg bg-white p-2 shadow-sm transition-opacity hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/badges/techbehemoths-trusted-2025.svg"
              alt="TechBehemoths Trusted Agency 2025"
              width={164}
              height={54}
              loading="lazy"
              className="h-8 w-auto"
            />
          </a>
        </div>
      </div>

      {locale === "fr" ? (
        <div className="container-x border-t border-white/[0.07] py-5">
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-faint">
            <li className="font-mono uppercase tracking-wide">Zones desservies</li>
            {LOCAL_LINKS.map((l) => (
              <li key={l.slug}>
                <Link href={`${base}/${l.slug}`} className="inline-block py-1.5 transition-colors hover:text-fg-muted">
                  {l.fr}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`${base}/agence-ia/ariege`} className="inline-block py-1.5 transition-colors hover:text-fg-muted">
                Ariège (09)
              </Link>
            </li>
            <li>
              <Link href={`${base}/agence-ia/haute-garonne`} className="inline-block py-1.5 transition-colors hover:text-fg-muted">
                Haute-Garonne (31)
              </Link>
            </li>
            <li>
              <Link href={`${base}/agence-ia`} className="inline-block py-1.5 transition-colors hover:text-fg-muted">
                toutes les villes →
              </Link>
            </li>
          </ul>
        </div>
      ) : null}

      <div className="container-x flex flex-col gap-2 border-t border-white/[0.07] py-6 text-xs text-fg-faint md:flex-row md:items-center md:justify-between">
        <p>© {YEAR} {c.footer.rights}</p>
        <p>{c.footer.note}</p>
      </div>
    </footer>
  );
}
