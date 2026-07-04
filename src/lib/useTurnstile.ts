"use client";

// Client hook: lazy-load the Turnstile script, render an invisible widget into
// a container, and expose the latest token. Used by every protected form.
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

export function useTurnstile(active: boolean) {
  const token = useRef<string>("");
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!key) return;
    const render = () => {
      if (window.turnstile && container.current && !container.current.hasChildNodes()) {
        window.turnstile.render(container.current, {
          sitekey: key,
          // "invisible" size was removed by Cloudflare; interaction-only keeps
          // the widget hidden and only shows a challenge if one is needed.
          // "flexible" makes that challenge fill its container (no 300px overflow
          // on narrow cards) when it does appear.
          appearance: "interaction-only",
          size: "flexible",
          callback: (tok: string) => { token.current = tok; },
          "refresh-expired": "auto",
        });
      }
    };
    if (window.turnstile) render();
    else {
      const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      if (existing) existing.addEventListener("load", render, { once: true });
      else {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.dataset.turnstile = "1";
        s.onload = render;
        document.head.appendChild(s);
      }
    }
  }, [active]);

  return { token, container };
}
