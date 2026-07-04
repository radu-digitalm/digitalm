"use client";

// Animates a stat like "15+" or "100+" from 0 when it scrolls into view.
// Non-numeric prefix/suffix preserved; reduced-motion (or no JS) shows the
// final value immediately — the SSR output is always the real number.
import { useEffect, useRef } from "react";

export function CountUp({ value, duration = 1200 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const m = value.match(/^([^0-9]*)([\d\s.,]+)(.*)$/);
    if (!m) return;
    const [, prefix, numRaw, suffix] = m;
    const target = parseFloat(numRaw!.replace(/[\s,]/g, ""));
    if (!isFinite(target) || target <= 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const step = (t: number) => {
          const p = Math.min((t - t0) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = `${prefix}${Math.round(target * eased)}${suffix}`;
          if (p < 1) requestAnimationFrame(step);
          else el.textContent = value;
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  return <span ref={ref}>{value}</span>;
}
