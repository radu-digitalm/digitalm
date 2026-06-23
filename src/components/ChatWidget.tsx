"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

// The heavy chat panel (AI SDK, ~hundreds of KB) is only imported once the
// visitor has consented to the third-party AI — keeps it out of the initial
// bundle AND means no third-party code loads until consent is given.
const ChatPanel = dynamic(() => import("./ChatPanel"), { ssr: false });

const OPEN_LABEL: Record<Locale, string> = {
  en: "Ask Digital M",
  fr: "Poser une question",
};

const CONSENT_KEY = "dm-consent"; // cookie banner: "all" | "essential"
const CHAT_KEY = "dm-chat"; // granular in-widget AI consent: "yes"

const CONSENT_COPY: Record<
  Locale,
  { title: string; body: string; accept: string; privacy: string; cancel: string }
> = {
  en: {
    title: "Chat with our assistant",
    body: "This assistant uses a third-party AI provider (OpenAI) to answer. Your messages are sent there to generate a reply — please don't share sensitive personal data.",
    accept: "Start chatting",
    privacy: "Privacy policy",
    cancel: "Not now",
  },
  fr: {
    title: "Discuter avec notre assistant",
    body: "Cet assistant utilise un prestataire d'IA tiers (OpenAI) pour répondre. Vos messages y sont envoyés pour générer une réponse — merci de ne pas partager de données personnelles sensibles.",
    accept: "Démarrer la conversation",
    privacy: "Politique de confidentialité",
    cancel: "Plus tard",
  },
};

function readChatAllowed(): boolean {
  try {
    const get = (k: string) =>
      localStorage.getItem(k) ||
      document.cookie.split("; ").find((c) => c.startsWith(`${k}=`))?.split("=")[1];
    return get(CONSENT_KEY) === "all" || get(CHAT_KEY) === "yes";
  } catch {
    return false;
  }
}

export function ChatWidget({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Keep the panel mounted once first opened with consent, so closing it
  // (X or launcher) just hides it and the conversation is preserved.
  useEffect(() => {
    if (open && allowed) setMounted(true);
  }, [open, allowed]);

  useEffect(() => {
    setAllowed(readChatAllowed());
    const onConsent = (e: Event) => {
      if ((e as CustomEvent).detail === "all") setAllowed(true);
    };
    const onChat = () => setAllowed(true);
    window.addEventListener("dm-consent", onConsent);
    window.addEventListener("dm-chat", onChat);
    return () => {
      window.removeEventListener("dm-consent", onConsent);
      window.removeEventListener("dm-chat", onChat);
    };
  }, []);

  // Granting chat consent is granular — it does NOT enable analytics (that
  // stays governed by the cookie banner's "all").
  function grantChatConsent() {
    document.cookie = `${CHAT_KEY}=yes; path=/; max-age=15552000; samesite=lax`;
    try {
      localStorage.setItem(CHAT_KEY, "yes");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("dm-chat"));
    setAllowed(true);
  }

  const cc = CONSENT_COPY[locale] ?? CONSENT_COPY.en;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={OPEN_LABEL[locale] ?? OPEN_LABEL.en}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-gradient text-ink shadow-lg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-magenta"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <path d="M5 5L17 17M17 5L5 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {allowed && mounted ? (
        <div className={open ? "" : "hidden"}>
          <ChatPanel locale={locale} onClose={() => setOpen(false)} />
        </div>
      ) : null}

      {open && !allowed ? (
        <aside
          role="dialog"
          aria-label={cc.title}
          className="fixed inset-x-3 bottom-24 z-40 flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/15 bg-surface-3 p-5 shadow-2xl ring-1 ring-accent/20 sm:inset-x-auto sm:right-6 sm:w-[calc(100vw-3rem)] sm:max-w-sm"
        >
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-brand-gradient" aria-hidden="true" />
            <span className="font-display text-sm font-medium text-fg-heading">{cc.title}</span>
          </span>
          <p className="text-sm leading-relaxed text-fg-muted">
            {cc.body}{" "}
            <Link href={`/${locale}/legal/confidentialite`} className="link-accent">
              {cc.privacy}
            </Link>
            .
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={grantChatConsent}
              className="rounded-full bg-brand-gradient px-4 py-2 text-xs font-medium text-ink transition-opacity hover:opacity-90"
            >
              {cc.accept}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-fg-heading transition-colors hover:bg-white/5"
            >
              {cc.cancel}
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
