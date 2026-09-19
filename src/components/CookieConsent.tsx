"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

const COPY: Record<
  Locale,
  {
    label: string;
    summary: string;
    body: string;
    more: string;
    less: string;
    privacy: string;
    privacyShort: string;
    accept: string;
    decline: string;
  }
> = {
  en: {
    label: "Cookies",
    summary: "We use cookies.",
    body: "We use one functional cookie to remember your language. With your consent, we also enable the on-site AI assistant and basic measurement. You can change your choice anytime.",
    more: "Details",
    less: "Hide details",
    privacy: "Privacy policy",
    privacyShort: "Privacy",
    accept: "Accept",
    decline: "Essential only",
  },
  fr: {
    label: "Cookies",
    summary: "Nous utilisons des cookies.",
    body: "Nous utilisons un seul cookie fonctionnel pour mémoriser votre langue. Avec votre consentement, nous activons aussi l'assistant IA du site et une mesure d'audience basique. Vous pouvez changer d'avis à tout moment.",
    more: "Détails",
    less: "Masquer les détails",
    privacy: "Politique de confidentialité",
    privacyShort: "Confidentialité",
    accept: "Accepter",
    decline: "Essentiels uniquement",
  },
};

const STORAGE_KEY = "dm-consent";

export function CookieConsent({ locale }: { locale: Locale }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
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

  // The bar is fixed to the bottom of the screen, so anything it lands on is
  // unreachable. Reserve its exact height at the bottom of the page while it is
  // up: the page can then always be scrolled far enough for any button to come
  // out from under it, and the space is given back the moment a choice is made.
  useEffect(() => {
    if (!show) return;
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.body.style.paddingBottom = `${h}px`;
    };
    apply();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(apply);
      ro.observe(el);
    }
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      document.body.style.removeProperty("padding-bottom");
    };
  }, [show, open]);

  // Announce it to assistive technology without trapping anyone: focus moves to
  // the bar, the page does not scroll, and Escape takes the careful choice.
  useEffect(() => {
    if (!show) return;
    const el = ref.current;
    if (!el) return;
    const id = window.setTimeout(() => {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [show]);

  const choose = useCallback((value: "all" | "essential") => {
    document.cookie = `${STORAGE_KEY}=${value}; path=/; max-age=15552000; samesite=lax`;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("dm-consent", { detail: value }));
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div
      ref={ref}
      data-dm-consent=""
      role="dialog"
      aria-modal="false"
      aria-label={copy.label}
      aria-describedby="dm-consent-summary"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          choose("essential");
        }
      }}
      className="fixed inset-x-0 bottom-0 z-50 px-2 outline-none sm:px-4"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto w-full max-w-content sm:px-2">
        <div className="card border border-white/10 bg-surface/95 p-3 shadow-xl backdrop-blur-md [@media(max-height:700px)]:p-2 sm:p-3">
          <div className="flex flex-col gap-2 [@media(max-height:700px)]:gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <p
              id="dm-consent-summary"
              className="min-w-0 text-xs leading-snug text-fg-muted sm:text-sm"
            >
              {copy.summary}{" "}
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="dm-consent-details"
                className="link-accent"
              >
                {open ? copy.less : copy.more}
              </button>
              <span aria-hidden="true"> · </span>
              <Link
                href={`/${locale}/legal/confidentialite`}
                className="link-accent"
              >
                <span className="sm:hidden">{copy.privacyShort}</span>
                <span className="hidden sm:inline">{copy.privacy}</span>
              </Link>
            </p>
            <div className="flex shrink-0 gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => choose("essential")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-white/15 px-3 text-center text-[13px] font-medium leading-tight text-fg-heading transition-colors hover:bg-white/5 [@media(max-height:700px)]:min-h-10 sm:min-h-10 sm:flex-none sm:px-4 sm:text-sm"
              >
                {copy.decline}
              </button>
              <button
                type="button"
                onClick={() => choose("all")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand-gradient px-3 text-center text-[13px] font-medium leading-tight text-ink transition-opacity hover:opacity-90 [@media(max-height:700px)]:min-h-10 sm:min-h-10 sm:flex-none sm:px-4 sm:text-sm"
              >
                {copy.accept}
              </button>
            </div>
          </div>
          <p
            id="dm-consent-details"
            hidden={!open}
            className="mt-2 max-h-[30vh] overflow-y-auto text-xs leading-relaxed text-fg-muted sm:text-sm"
          >
            {copy.body}
          </p>
        </div>
      </div>
    </div>
  );
}
