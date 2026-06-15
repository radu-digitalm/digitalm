"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Locale } from "@/lib/i18n";

// The heavy chat panel (AI SDK, ~hundreds of KB) is only fetched when the
// visitor actually opens the chat — keeps it out of the initial page bundle.
const ChatPanel = dynamic(() => import("./ChatPanel"), { ssr: false });

const OPEN_LABEL: Record<Locale, string> = {
  en: "Ask Digital M",
  fr: "Poser une question",
};

const CONSENT_KEY = "dm-consent";

function readConsent(): boolean {
  try {
    const ls = localStorage.getItem(CONSENT_KEY);
    if (ls) return ls === "all";
    const ck = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${CONSENT_KEY}=`))
      ?.split("=")[1];
    return ck === "all";
  } catch {
    return false;
  }
}

export function ChatWidget({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    setConsented(readConsent());
    const onConsent = (e: Event) =>
      setConsented((e as CustomEvent).detail === "all");
    window.addEventListener("dm-consent", onConsent);
    return () => window.removeEventListener("dm-consent", onConsent);
  }, []);

  // The assistant sends messages to a third-party AI provider, so it only
  // appears once the visitor has accepted on the consent banner.
  if (!consented) return null;

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

      {open ? <ChatPanel locale={locale} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
