"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

const COPY: Record<
  Locale,
  { body: string; privacy: string; accept: string; decline: string }
> = {
  en: {
    body: "We use one functional cookie to remember your language. With your consent, we also enable the on-site AI assistant and basic measurement. You can change your choice anytime.",
    privacy: "Privacy policy",
    accept: "Accept",
    decline: "Essential only",
  },
  fr: {
    body: "Nous utilisons un seul cookie fonctionnel pour mémoriser votre langue. Avec votre consentement, nous activons aussi l'assistant IA du site et une mesure d'audience basique. Vous pouvez changer d'avis à tout moment.",
    privacy: "Politique de confidentialité",
    accept: "Accepter",
    decline: "Essentiels uniquement",
  },
};

const STORAGE_KEY = "dm-consent";

export function CookieConsent({ locale }: { locale: Locale }) {
  const [show, setShow] = useState(false);
  const copy = COPY[locale];

  useEffect(() => {
    try {
      const stored =
        localStorage.getItem(STORAGE_KEY) ||
        document.cookie
          .split("; ")
          .find((c) => c.startsWith(`${STORAGE_KEY}=`))
          ?.split("=")[1];
      if (!stored) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  function choose(value: "all" | "essential") {
    document.cookie = `${STORAGE_KEY}=${value}; path=/; max-age=15552000; samesite=lax`;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("dm-consent", { detail: value }));
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label={copy.privacy}
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="container-x">
        <div className="card flex flex-col gap-4 border border-white/10 bg-surface/95 p-5 shadow-xl backdrop-blur-md md:flex-row md:items-center md:justify-between md:gap-8">
          <p className="text-sm leading-relaxed text-fg-muted">
            {copy.body}{" "}
            <Link
              href={`/${locale}/legal/confidentialite`}
              className="link-accent"
            >
              {copy.privacy}
            </Link>
            .
          </p>
          <div className="flex shrink-0 gap-3">
            <button
              type="button"
              onClick={() => choose("essential")}
              className="rounded-lg border border-white/15 px-4 py-3 text-sm font-medium text-fg-heading transition-colors hover:bg-white/5"
            >
              {copy.decline}
            </button>
            <button
              type="button"
              onClick={() => choose("all")}
              className="rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              {copy.accept}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
