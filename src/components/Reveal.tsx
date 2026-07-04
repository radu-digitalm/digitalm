"use client";

// Scroll-reveal driver. Adds `reveal-on` to <html>, then reveals every
// `.reveal` element as it enters the viewport (staggered within its parent).
// Cross-browser (IntersectionObserver), no-op under prefers-reduced-motion,
// and content stays fully visible if this never runs.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    root.classList.add("reveal-on");

    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)"));
    if (!els.length) return;

    // Stagger siblings within the same parent (capped so long lists don't lag).
    const seen = new Map<Element, number>();
    for (const el of els) {
      const parent = el.parentElement;
      if (!parent) continue;
      const i = seen.get(parent) ?? 0;
      el.style.setProperty("--reveal-i", String(Math.min(i, 6)));
      seen.set(parent, i + 1);
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    // Already in view at mount → show instantly (no flicker); the rest animate in.
    const vh = window.innerHeight;
    for (const el of els) {
      if (el.getBoundingClientRect().top < vh * 0.9) el.classList.add("is-visible");
      else io.observe(el);
    }

    return () => io.disconnect();
  }, [pathname]);

  return null;
}
