import Link from "next/link";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";

const YEAR = 2026;

export function SiteFooter({ locale }: { locale: Locale }) {
  const c = getContent(locale);
  const base = `/${locale}`;

  return (
    <footer className="mt-24 border-t border-white/[0.07]">
      <div className="container-x grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-white.webp" alt="Digital M" className="h-16 w-auto" />
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
                href="https://www.linkedin.com/company/digital-management-ltd"
                target="_blank"
                rel="noopener noreferrer"
              >
                LinkedIn
              </a>
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
        </div>
      </div>

      <div className="container-x flex flex-col gap-2 border-t border-white/[0.07] py-6 text-xs text-fg-faint md:flex-row md:items-center md:justify-between">
        <p>© {YEAR} {c.footer.rights}</p>
        <p>{c.footer.note}</p>
      </div>
    </footer>
  );
}
