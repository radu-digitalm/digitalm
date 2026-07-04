"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, type Locale } from "@/lib/i18n";

export function LanguageToggle({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  const pathname = usePathname() || `/${locale}`;
  const rest = pathname.replace(/^\/(en|fr)/, "");

  function persist(target: Locale) {
    document.cookie = `NEXT_LOCALE=${target}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div
      className={`inline-flex overflow-hidden rounded-full border border-white/15 font-mono text-xs ${className ?? ""}`}
      role="group"
      aria-label="Language"
    >
      {locales.map((l) => {
        const active = l === locale;
        if (active) {
          return (
            <span
              key={l}
              aria-current="true"
              className="bg-brand-gradient px-3.5 py-2.5 font-medium text-ink"
            >
              {l.toUpperCase()}
            </span>
          );
        }
        return (
          <Link
            key={l}
            href={`/${l}${rest || ""}`}
            onClick={() => persist(l)}
            className="px-3.5 py-2.5 text-fg-muted transition-colors hover:text-fg-heading"
          >
            {l.toUpperCase()}
          </Link>
        );
      })}
    </div>
  );
}
