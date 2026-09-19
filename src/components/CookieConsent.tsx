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
import { clearance } from "@/components/consentClearance";
import type { ConsentBox } from "@/components/consentClearance";

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

// How long a page is allowed to keep arranging itself — the router's own
// scroll, the phone fields, the booking slots — before the bar leaves the
// scroll position alone for good.
const SETTLING = 4000;

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
  //   3. while a page is still arranging itself, the right scroll position is
  //      worked out again from the layout as it stands at that moment, and
  //      the page is only ever moved to a place where the bar covers nothing
  //      at all. Where no such place exists within a bar's height, the page is
  //      handed straight back to where it was, so the bar can never leave a
  //      control worse off than if it were not there;
  //   4. the browser's own scroll-into-view is told to keep clear of it.
  // The bar stops moving the page the moment the visitor scrolls or taps for
  // themselves, and everything is handed back when a choice is made.
  useMeasureEffect(() => {
    if (!show) return;
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const lifted: { node: HTMLElement; previous: string }[] = [];
    // How much of the page's current scroll position is ours rather than the
    // visitor's. It stays ours to give back: every pass recomputes the whole
    // move from scratch, so a page that was still growing when the first pass
    // ran is put right by the next one instead of being stuck with it.
    let applied = 0;
    let taken = false;
    let pending = 0;
    let frame = 0;
    let settling = Date.now() + SETTLING;
    let known = root.scrollHeight;

    const drop = () => {
      for (const entry of lifted.splice(0)) {
        entry.node.style.transform = entry.previous;
      }
    };

    // Fixed furniture cannot be scrolled clear, so move it above the bar.
    // Once a piece has been claimed it stays claimed and is only re-aimed: the
    // chat launcher animates its transform, so dropping it and looking again
    // catches it mid-flight with a transform of its own and abandons it there,
    // under the bar. New furniture — the chat's own consent card — is picked
    // up whenever it appears.
    const liftFixed = (height: number, barTop: number) => {
      const vh = window.innerHeight;
      for (const entry of lifted) {
        entry.node.style.transform = `translateY(-${height}px)`;
      }
      for (const node of Array.from(document.body.children)) {
        if (!(node instanceof HTMLElement) || node === el) continue;
        if (lifted.some((entry) => entry.node === node)) continue;
        const style = window.getComputedStyle(node);
        if (style.position !== "fixed" || style.transform !== "none") continue;
        const box = node.getBoundingClientRect();
        if (box.height < 1 || box.height > vh * 0.9) continue;
        if (box.bottom <= barTop || box.top >= vh) continue;
        lifted.push({ node, previous: node.style.transform });
        node.style.transform = `translateY(-${height}px)`;
      }
    };

    // Anything pinned to the screen goes with the screen, so scrolling can
    // never free it and it must not be allowed to veto a move. The fixed
    // furniture above is lifted instead.
    const pinnedIn = (node: HTMLElement, seen: Map<Element, boolean>) => {
      const chain: Element[] = [];
      let current: HTMLElement | null = node;
      let answer = false;
      while (current && current !== document.body) {
        const cached = seen.get(current);
        if (cached !== undefined) {
          answer = cached;
          break;
        }
        chain.push(current);
        const position = window.getComputedStyle(current).position;
        if (position === "fixed" || position === "sticky") {
          answer = true;
          break;
        }
        current = current.parentElement;
      }
      for (const entry of chain) seen.set(entry, answer);
      return answer;
    };

    // Where the page has to sit for the bar to be covering nothing. It starts
    // from where the visitor would be if the bar were not here, takes the
    // smallest move that frees every control the bar's strip of screen would
    // otherwise hold, and takes none at all if no move within reach does that.
    // A control counts as free when a thumb's worth of it is above the bar, or
    // when it is still below the fold and a scroll away.
    const settle = () => {
      if (taken) return;
      const box = el.getBoundingClientRect();
      const height = Math.ceil(box.height);
      liftFixed(height, box.top);
      const vh = window.innerHeight;
      const here = window.scrollY || window.pageYOffset || 0;
      const base = Math.max(0, here - applied);
      // Far enough to step over the block the bar came down on, and no
      // further: the page the visitor paid to land on stays in view.
      const cap = Math.min(
        height * 2,
        Math.max(0, root.scrollHeight - vh - base),
      );
      const boxes: ConsentBox[] = [];
      const seen = new Map<Element, boolean>();
      for (const node of Array.from(
        document.querySelectorAll<HTMLElement>(CONTROLS),
      )) {
        if (el.contains(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        // Nowhere near the bar's strip of screen, whatever we do: not worth
        // the cost of asking the browser about it.
        if (rect.bottom <= box.top - 8 || rect.top >= vh + cap) continue;
        if (window.getComputedStyle(node).visibility === "hidden") continue;
        if (pinnedIn(node, seen)) continue;
        boxes.push({ top: rect.top + here, height: rect.height });
      }
      const best = clearance({ base, view: vh, bar: height, reach: cap, boxes });
      const target = Math.round(base + best);
      if (Math.abs(target - here) > 0.5) {
        window.scrollTo({ top: target, left: 0, behavior: "instant" });
      }
      applied = Math.max(0, (window.scrollY || window.pageYOffset || 0) - base);
      known = root.scrollHeight;
    };

    // Moving from one page to the next, the router scrolls the new page into
    // place with an animation of its own, and booking slots and phone fields
    // are drawn a moment after the bar is. So the move waits for the page to
    // stop changing, only while it is still settling, and not at all once the
    // visitor is scrolling for themselves.
    const soon = (delay: number) => {
      if (taken || Date.now() > settling) return;
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (!taken) settle();
      }, delay);
    };
    const onScroll = () => soon(150);
    // The page grew or shrank under us — a client-rendered form, a list of
    // booking slots. Whatever was decided against the old layout is decided
    // again against this one.
    const onGrow = () => {
      if (root.scrollHeight === known) return;
      known = root.scrollHeight;
      soon(60);
    };
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
      liftFixed(height, box.top);
    };

    apply();
    // On the page the visitor landed on there is nothing to wait for: make
    // room in the next frame, before they can reach for anything. The passes
    // after it exist for everything the page draws afterwards.
    frame = window.requestAnimationFrame(settle);
    const timers = [120, 300, 700, 1400, 2400, 3400].map((delay) =>
      window.setTimeout(() => soon(60), delay),
    );
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== "undefined") {
      const bar = new ResizeObserver(() => {
        apply();
        soon(60);
      });
      bar.observe(el);
      const page = new ResizeObserver(onGrow);
      page.observe(document.body);
      observers.push(bar, page);
    }
    // Furniture that turns up later — the chat's consent card opens long after
    // the page has settled — still has to ride above the bar. This only moves
    // that furniture; it never moves the page, so it keeps working after the
    // visitor has taken over.
    let watcher: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
      watcher = new MutationObserver(() => {
        const box = el.getBoundingClientRect();
        liftFixed(Math.ceil(box.height), box.top);
      });
      watcher.observe(document.body, { childList: true });
    }
    // A turn of the phone is a new page as far as the layout is concerned.
    const onRotate = () => {
      taken = false;
      settling = Date.now() + SETTLING;
      apply();
      soon(60);
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
      for (const observer of observers) observer.disconnect();
      if (watcher) watcher.disconnect();
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
  // the bar, the page does not scroll, and Escape there takes the careful
  // choice. Escape belongs to whatever the visitor is actually in — an open
  // menu, a dialog, a field — so it is only taken when the bar has the focus or
  // nothing else does. A decision this permanent is never recorded on a key
  // press meant for something else.
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
      if (active && active !== document.body && !el.contains(active)) return;
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
