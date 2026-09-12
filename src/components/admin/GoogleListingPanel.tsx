"use client";

// Google's own listing panel (docs/finder-google-spec.md §5.7): the Places UI
// Kit details element, created imperatively after `importLibrary("places")`
// and removed on cleanup. Full variant (`gmp-place-details` with an explicit
// content config — address, website, phone, opening hours, rating, media,
// attribution) for the Google-only card and the prospect page; compact
// variant (`gmp-place-details-compact`, standard content) for the business
// card. Google renders name, address, rating, website, photo and its own
// attribution — nothing of it passes through our code; on `gmp-error` one
// sentence says the panel could not be loaded. One UI Kit query per mount.
import { useEffect, useRef, useState } from "react";
import { createPlacesElement, importLibrary, placeIdOk } from "./googleMaps";
import { GOOGLE_TEXT } from "./wording";

const FULL_CONTENT = ["gmp-place-address", "gmp-place-website", "gmp-place-phone-number", "gmp-place-opening-hours", "gmp-place-rating", "gmp-place-media", "gmp-place-attribution"];

export function GoogleListingPanel({ placeId, variant, className = "" }: { placeId: string; variant: "full" | "compact"; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!placeIdOk(placeId)) {
      setState("failed");
      return;
    }
    let cancelled = false;
    let el: HTMLElement | null = null;
    (async () => {
      try {
        await importLibrary("places");
        if (cancelled || !box.current) return;
        const request = createPlacesElement("gmp-place-details-place-request", { "attr:place": placeId });
        const content =
          variant === "full"
            ? createPlacesElement(
                "gmp-place-content-config",
                {},
                FULL_CONTENT.map((tag) => createPlacesElement(tag)),
              )
            : createPlacesElement("gmp-place-standard-content");
        el = createPlacesElement(variant === "full" ? "gmp-place-details" : "gmp-place-details-compact", variant === "compact" ? { "attr:orientation": "vertical" } : {}, [request, content]);
        el.classList.add("dm-gplace", variant === "full" ? "dm-gplace-full" : "dm-gplace-compact");
        el.addEventListener("gmp-error", () => {
          if (!cancelled) setState("failed");
        });
        el.addEventListener("gmp-load", () => {
          if (!cancelled) setState("ready");
        });
        box.current.replaceChildren(el);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [placeId, variant]);

  return (
    <div className={className} data-testid={`google-listing-${variant}`}>
      <div ref={box} className="dm-gplace-box" />
      {state === "loading" ? <p className="text-[15px] text-fg-muted">{GOOGLE_TEXT.panelLoading}</p> : null}
      {state === "failed" ? <p className="text-[16px] text-fg-muted">{GOOGLE_TEXT.panelFailed}</p> : null}
    </div>
  );
}
