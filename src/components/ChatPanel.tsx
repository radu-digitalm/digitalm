"use client";

import { useRef, useEffect, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { Locale } from "@/lib/i18n";

const PATH_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    "/": "Home",
    "/services": "Services",
    "/work": "Work",
    "/contact": "Contact",
    "/legal/mentions-legales": "Legal notice",
    "/legal/confidentialite": "Privacy policy",
  },
  fr: {
    "/": "Accueil",
    "/services": "Services",
    "/work": "Réalisations",
    "/contact": "Contact",
    "/legal/mentions-legales": "Mentions légales",
    "/legal/confidentialite": "Politique de confidentialité",
  },
};

function labelForPath(path: string, locale: Locale): string | null {
  const map = PATH_LABELS[locale] ?? PATH_LABELS.en;
  return map[path] ?? map[path.split("#")[0]!] ?? null;
}

function renderInlineMarkdown(text: string, keyBase: string): ReactNode[] {
  if (!text.includes("**")) return [text];
  const parts: ReactNode[] = [];
  let i = 0;
  let lastIdx = 0;
  const re = /\*\*([^*\n]+?)\*\*/g;
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    if (start > lastIdx) parts.push(text.slice(lastIdx, start));
    parts.push(
      <strong key={`${keyBase}-b${i++}`} className="font-medium text-fg-heading">
        {m[1]}
      </strong>,
    );
    lastIdx = start + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function renderRichText(text: string, locale: Locale): ReactNode[] {
  const pattern =
    /(https?:\/\/[^\s<>()]+|\/[a-z][a-z0-9\-/#]*|[\w.+-]+@[\w.-]+\.[a-z]{2,})/gi;
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index!;
    let token = m[0];
    let trailing = "";
    while (token.length > 0 && /[.,;:!?)]/.test(token[token.length - 1]!)) {
      trailing = token[token.length - 1]! + trailing;
      token = token.slice(0, -1);
    }
    const end = start + token.length;
    if (start > lastIndex) {
      out.push(...renderInlineMarkdown(text.slice(lastIndex, start), `s${key++}`));
    }

    if (token.startsWith("/")) {
      const label = labelForPath(token, locale);
      if (!label) {
        out.push(token);
      } else {
        const href = `/${locale}${token === "/" ? "" : token}`;
        out.push(
          <a
            key={`l-${key++}`}
            href={href}
            className="mx-0.5 inline-flex items-baseline gap-1 whitespace-nowrap rounded-md border border-white/10 bg-surface-2 px-2 py-[0.15rem] align-baseline text-[0.8125rem] font-medium text-accent-soft no-underline transition hover:bg-accent hover:text-ink"
          >
            <span>{label}</span>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="translate-y-[1px] opacity-70">
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>,
        );
      }
    } else if (token.startsWith("http")) {
      out.push(
        <a key={`l-${key++}`} href={token} target="_blank" rel="noreferrer" className="font-medium text-accent-soft underline underline-offset-2 hover:text-accent-magenta">
          {token}
        </a>,
      );
    } else {
      out.push(
        <a key={`l-${key++}`} href={`mailto:${token}`} className="font-medium text-accent-soft underline underline-offset-2 hover:text-accent-magenta">
          {token}
        </a>,
      );
    }

    if (trailing) out.push(trailing);
    lastIndex = end + trailing.length;
  }
  if (lastIndex < text.length) {
    out.push(...renderInlineMarkdown(text.slice(lastIndex), `s${key++}`));
  }
  return out;
}

const STRINGS: Record<
  Locale,
  {
    title: string;
    intro: string;
    placeholder: string;
    send: string;
    close: string;
    error: string;
    starters: string[];
  }
> = {
  en: {
    title: "Digital M assistant",
    intro: "Ask about our AI, e-commerce and CRM work — or how we can help.",
    placeholder: "Ask a question…",
    send: "Send",
    close: "Close",
    error: "Sorry, I can't respond right now. You can email contact@digitalm.eu.",
    starters: [
      "I run a shop and want AI to handle customer messages",
      "I need a new website — fast and affordable",
      "Can you audit my online store's security?",
    ],
  },
  fr: {
    title: "Assistant Digital M",
    intro: "Posez une question sur notre travail en IA, e-commerce et CRM — ou comment nous pouvons aider.",
    placeholder: "Posez votre question…",
    send: "Envoyer",
    close: "Fermer",
    error: "Désolé, je ne peux pas répondre pour le moment. Écrivez à contact@digitalm.eu.",
    starters: [
      "Je tiens une boutique et je veux une IA pour les messages clients",
      "J'ai besoin d'un nouveau site — rapide et abordable",
      "Pouvez-vous auditer la sécurité de ma boutique ?",
    ],
  },
};

export default function ChatPanel({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const s = STRINGS[locale] ?? STRINGS.en;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const isPending = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <aside
      role="dialog"
      aria-label={s.title}
      className="fixed inset-x-3 bottom-24 z-40 flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[calc(100vw-3rem)] sm:max-w-sm"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-gradient" aria-hidden="true" />
          <span className="font-display text-sm font-medium text-fg-heading">{s.title}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={s.close}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-muted transition hover:bg-white/10 hover:text-fg-heading"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-fg-faint">{s.intro}</p>
            <div className="flex flex-col gap-2">
              {s.starters.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendMessage({ text: q })}
                  className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:border-accent/40 hover:text-fg-heading"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-6 rounded-2xl bg-surface-2 px-3 py-2 text-fg"
                : "mr-2 rounded-2xl bg-white/[0.04] px-3 py-2 text-fg"
            }
          >
            {m.parts.map((part, i) =>
              part.type === "text" ? (
                <span key={i} className="whitespace-pre-wrap leading-relaxed">
                  {m.role === "user" ? part.text : renderRichText(part.text, locale)}
                </span>
              ) : null,
            )}
          </div>
        ))}
        {isPending ? <p className="text-xs text-fg-faint">…</p> : null}
        {status === "error" ? (
          <p role="alert" className="text-xs text-accent-soft">{s.error}</p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const text = String(fd.get("input") ?? "").trim();
          if (!text) return;
          sendMessage({ text });
          e.currentTarget.reset();
        }}
        className="flex gap-2 border-t border-white/10 p-3"
      >
        <input
          name="input"
          type="text"
          placeholder={s.placeholder}
          autoComplete="off"
          className="flex-1 rounded-full border border-white/10 bg-surface-2 px-4 py-2 text-sm text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-brand-gradient px-4 py-2 text-xs font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {s.send}
        </button>
      </form>
    </aside>
  );
}
