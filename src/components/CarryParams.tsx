"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { attributionQuery } from "@/lib/attributionClient";

// Keeps campaign parameters (utm_*, oppref) on the way from an ad landing page
// to the forms. A visitor who lands on /fr/pme?utm_source=chatgpt and clicks
// "Check-up gratuit" reaches /fr/diagnostic?utm_source=chatgpt, so the lead is
// attributed. Done at click time on the URL only — no cookie, no storage.
const CARRY_TO = /^\/(en|fr)\/(diagnostic|book|contact)(\/|$)/;

export function CarryParams() {
  const router = useRouter();
  useEffect(() => {
    if (!attributionQuery()) return; // nothing to carry on this page
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      const url = new URL(a.href);
      if (!CARRY_TO.test(url.pathname)) return;
      const carry = new URLSearchParams(attributionQuery());
      let changed = false;
      carry.forEach((v, k) => {
        if (!url.searchParams.has(k)) { url.searchParams.set(k, v); changed = true; }
      });
      if (!changed) return;
      e.preventDefault();
      e.stopPropagation();
      router.push(url.pathname + url.search + url.hash);
    };
    // Capture phase: runs before next/link's own handler.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);
  return null;
}
