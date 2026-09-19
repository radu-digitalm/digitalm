"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
    summary:
      "We use cookies: your language, the AI assistant, audience measurement.",
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
    summary:
      "Nous utilisons des cookies : votre langue, l'assistant IA, la mesure d'audience.",
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

// Anything a visitor can tap or type into. The bar must not be sitting on one
// of these when it appears.
const CONTROLS =
  "a[href], button, input:not([type='hidden']), select, textarea, summary, [role='button'], [tabindex]:not([tabindex='-1'])";

// What tells us the visitor has taken the page over.
const TAKEOVER = ["pointerdown", "wheel", "touchmove", "keydown"] as const;

// The bar is drawn after hydration. Measuring it and reserving its space in the
// same frame, before the browser paints, means the page is never left with a
// button stranded behind it.
const useMeasureEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function CookieConsent({ locale }: { locale: Locale }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // The bar outlives a move from one page to the next, so the room it needs is
  // worked out again on every page the visitor opens while it is up.
  const pathname = usePathname();
  // True once the page the visitor landed on has had its room made.
  const arrived = useRef(false);
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

  // The bar is fixed to the bottom of the screen, so whatever it lands on is
  // dead to the thumb. Four things keep that from happening where it counts:
  //   1. its exact height is reserved at the end of the page, so anything in
  //      the document can always be scrolled out from under it;
  //   2. page furniture that is fixed too (the chat launcher) rides above it,
  //      since scrolling can never free that;
  //   3. as each page arrives, the page is lifted by the smallest amount that
  //      frees every control the bar came down on, so the first screen the
  //      visitor sees is the one they would have seen without it;
  //   4. the browser's own scroll-into-view is told to keep clear of it.
  // The bar stops moving the page the moment the visitor scrolls or taps for
  // themselves, and everything is handed back when a choice is made.
  useMeasureEffect(() => {
    if (!show) return;
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const lifted: { node: HTMLElement; previous: string }[] = [];
    let reserved = 0;
    // The page is never moved by more than the height of the bar in total, and
    // never once the visitor has started scrolling for themselves.
    let spent = 0;
    let taken = false;
    let pending = 0;
    let frame = 0;
    let settling = Date.now() + 2500;

    const drop = () => {
      for (const entry of lifted.splice(0)) {
        entry.node.style.transform = entry.previous;
      }
    };

    // Fixed furniture cannot be scrolled clear, so move it above the bar.
    const lift = (height: number, barTop: number) => {
      drop();
      const vh = window.innerHeight;
      for (const node of Array.from(document.body.children)) {
        if (!(node instanceof HTMLElement) || node === el) continue;
        const style = window.getComputedStyle(node);
        if (style.position !== "fixed" || style.transform !== "none") continue;
        const box = node.getBoundingClientRect();
        if (box.height < 1 || box.height > vh * 0.9) continue;
        if (box.bottom <= barTop || box.top >= vh) continue;
        lifted.push({ node, previous: node.style.transform });
        node.style.transform = `translateY(-${height}px)`;
      }
    };

    // How far the page has to move for every control the bar came down on to
    // come out from under it. If that lift would only land the bar on the next
    // control down, it looks a little further for a gap to land in. Never more
    // than the page can scroll, and never more than half a bar past the bar's
    // own height in total.
    const clear = (height: number, barTop: number) => {
      const vh = window.innerHeight;
      const budget = height - spent;
      const room = Math.max(
        0,
        root.scrollHeight - vh - (window.scrollY || window.pageYOffset || 0),
      );
      if (budget < 1 || room < 1) return;
      const reach = Math.min(budget * 1.5, room);
      const boxes: { top: number; bottom: number }[] = [];
      let needed = 0;
      for (const node of Array.from(
        document.querySelectorAll<HTMLElement>(CONTROLS),
      )) {
        if (el.contains(node)) continue;
        if (lifted.some((entry) => entry.node.contains(node))) continue;
        const box = node.getBoundingClientRect();
        if (box.width < 8 || box.height < 8) continue;
        if (box.bottom <= barTop || box.top >= vh + reach) continue;
        const style = window.getComputedStyle(node);
        if (style.visibility === "hidden" || style.position === "fixed") continue;
        boxes.push({ top: box.top, bottom: box.bottom });
        if (box.top < vh) needed = Math.max(needed, box.bottom - barTop);
      }
      const clears = (value: number) =>
        boxes.every(
          (box) => box.bottom - value <= barTop || box.top - value >= vh,
        );
      let shift = Math.min(needed, budget, room);
      if (shift > 0.5 && !clears(shift)) {
        const gaps: number[] = [];
        for (const box of boxes) {
          for (const value of [box.bottom - barTop, box.top - vh]) {
            if (value > shift && value <= reach) gaps.push(value);
          }
        }
        gaps.sort((a, b) => a - b);
        for (const value of gaps) {
          if (clears(value)) {
            shift = value;
            break;
          }
        }
      }
      if (shift > 0.5) {
        window.scrollBy({ top: shift, left: 0, behavior: "instant" });
        spent += shift;
      }
    };

    const liftPage = () => {
      const box = el.getBoundingClientRect();
      clear(Math.ceil(box.height), box.top);
    };

    // Moving from one page to the next, the router scrolls the new page into
    // place with an animation of its own, and booking slots and phone fields
    // are drawn a moment after the bar is. So the lift waits for the page to
    // stop moving, only while it is still settling, and not at all once the
    // visitor is scrolling for themselves.
    const soon = (delay: number) => {
      if (taken || Date.now() > settling) return;
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (!taken) liftPage();
      }, delay);
    };
    const onScroll = () => soon(150);
    // The visitor has reached for the page itself: from here on it is theirs,
    // and the bar stops moving it. Reaching for the bar does not count.
    const onTakeOver = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && el.contains(target)) return;
      taken = true;
      window.clearTimeout(pending);
      window.cancelAnimationFrame(frame);
    };

    const apply = () => {
      const box = el.getBoundingClientRect();
      const height = Math.ceil(box.height);
      document.body.style.paddingBottom = `${height}px`;
      // Keeps the browser's own "scroll this into view" (anchors, focused
      // fields, scrollIntoView) from parking anything behind the bar.
      root.style.scrollPaddingBottom = `${height}px`;
      lift(height, box.top);
      if (height > reserved) {
        reserved = height;
        if (arrived.current) {
          soon(150);
        } else {
          // On the page the visitor landed on there is nothing to wait for:
          // make room in the next frame, before they can reach for anything.
          arrived.current = true;
          window.cancelAnimationFrame(frame);
          frame = window.requestAnimationFrame(liftPage);
        }
      }
    };

    apply();
    const timers = [300, 900, 1800].map((delay) =>
      window.setTimeout(() => soon(60), delay),
    );
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(apply);
      observer.observe(el);
    }
    // A turn of the phone is a new page as far as the layout is concerned.
    const onRotate = () => {
      taken = false;
      reserved = 0;
      settling = Date.now() + 1500;
      apply();
    };
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", onRotate);
    window.addEventListener("scroll", onScroll, { passive: true });
    for (const kind of TAKEOVER) {
      window.addEventListener(kind, onTakeOver, { passive: true });
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.clearTimeout(pending);
      window.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", onRotate);
      window.removeEventListener("scroll", onScroll);
      for (const kind of TAKEOVER) {
        window.removeEventListener(kind, onTakeOver);
      }
      drop();
      document.body.style.removeProperty("padding-bottom");
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, [show, pathname]);

  // Announce it to assistive technology without trapping anyone: focus moves to
  // the bar, the page does not scroll, and Escape takes the careful choice from
  // anywhere on the page, unless another control is plainly the one that owns
  // the key (an open menu or dialog, a field being typed into).
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && !el.contains(active)) {
        if (active.closest("[role='dialog'], [aria-modal='true']")) return;
        if (
          active.matches(
            "input, textarea, select, [contenteditable='true'], [aria-expanded='true']",
          )
        ) {
          return;
        }
      }
      choose("essential");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [show, choose]);

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
                className="link-accent inline-block px-1 py-1 -mx-1 -my-1 align-middle"
              >
                {open ? copy.less : copy.more}
              </button>
              <span aria-hidden="true"> · </span>
              <Link
                href={`/${locale}/legal/confidentialite`}
                className="link-accent inline-block px-1 py-1 -mx-1 -my-1 align-middle"
              >
                <span className="sm:hidden">{copy.privacyShort}</span>
                <span className="hidden sm:inline">{copy.privacy}</span>
              </Link>
            </p>
            <div className="flex shrink-0 gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => choose("essential")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-white/15 px-3 text-center text-[13px] font-medium leading-tight text-fg-heading transition-colors hover:bg-white/5 sm:flex-none sm:px-4 sm:text-sm"
              >
                {copy.decline}
              </button>
              <button
                type="button"
                onClick={() => choose("all")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand-gradient px-3 text-center text-[13px] font-medium leading-tight text-ink transition-opacity hover:opacity-90 sm:flex-none sm:px-4 sm:text-sm"
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
