"use client";

// The card for a pin Google knows and no other source listed
// (docs/finder-google-spec.md §5.5): no name of ours anywhere — the body is
// Google's own full listing panel (name, address, website, phone, hours,
// rating, a photo, Google's attribution), then View on Google Maps and the two
// actions: Add by its website (the Add-by-URL form with the place id attached
// and no name field — the name comes from the site, D3) and Not this one. A
// pin already saved shows the reference and a link to the prospect instead.
// Same frames and keys as the business card (Esc closes, Back / Close).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AddByUrl } from "./AddByUrl";
import { Button } from "./Button";
import type { CardLayout } from "./BusinessCard";
import type { AddByUrlResponse, GooglePin, ResolvedArea } from "./finderApi";
import { GoogleListingPanel } from "./GoogleListingPanel";
import { googleMapsPlaceUrl } from "./googleMaps";
import { CARD_TEXT, FIND_TEXT, GOOGLE_TEXT, fill } from "./wording";

export type GoogleOnlyCardProps = {
  pin: GooglePin;
  area: ResolvedArea;
  layout: CardLayout;
  onClose: () => void;
  /** The Add-by-URL answer (a new prospect, or an existing one the listing was attached to). */
  onSaved: (r: AddByUrlResponse) => void;
  onDismiss: () => void;
  onShowOnMap?: () => void;
};

export function GoogleOnlyCard({ pin, area, layout, onClose, onSaved, onDismiss, onShowOnMap }: GoogleOnlyCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const titleId = `google-card-${pin.placeId.replace(/[^a-z0-9]/gi, "-")}`;
  const mapsUrl = googleMapsPlaceUrl(pin.placeId);

  useEffect(() => {
    heading.current?.focus();
    setAdding(false);
  }, [pin.placeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const frame =
    layout === "overlay"
      ? "absolute inset-y-0 right-0 z-20 w-[420px] max-w-full border-l border-line bg-surface shadow-2xl"
      : layout === "sheet"
        ? "fixed inset-y-0 right-0 z-50 w-[420px] max-w-full border-l border-line bg-surface shadow-2xl"
        : "fixed inset-0 z-50 bg-surface";

  return (
    <div role="dialog" aria-modal={layout !== "overlay"} aria-labelledby={titleId} data-testid="google-only-card" className={`${frame} flex flex-col`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Button size="sm" onClick={onClose} aria-label={layout === "full" ? FIND_TEXT.close : FIND_TEXT.back}>
          {layout === "full" ? FIND_TEXT.close : `← ${FIND_TEXT.back}`}
        </Button>
        <span className="flex-1" />
        {onShowOnMap ? (
          <Button size="sm" onClick={onShowOnMap}>
            {FIND_TEXT.showOnMap}
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="h-full space-y-4 overflow-y-auto px-4 pb-10 pt-4">
          <header>
            <h2 id={titleId} ref={heading} tabIndex={-1} className="text-[22px] leading-tight text-fg-heading outline-none">
              {pin.saved ? fill(GOOGLE_TEXT.onlyOnGoogleSaved, { reference: pin.saved.reference }) : GOOGLE_TEXT.onlyOnGoogle}
            </h2>
            <p className="mt-1 text-[15px] text-fg-muted">{GOOGLE_TEXT.googleOnlyHint}</p>
          </header>

          <GoogleListingPanel placeId={pin.placeId} variant="full" />

          {mapsUrl ? (
            <p>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
                {GOOGLE_TEXT.viewOnGoogleMaps}
              </a>
            </p>
          ) : null}

          {adding && !pin.saved ? <AddByUrl inline noName googlePlaceId={pin.placeId} country={area.countryCode} onSaved={onSaved} onCancel={() => setAdding(false)} /> : null}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
      </div>

      <div className="space-y-2 border-t border-line px-4 py-3">
        {pin.saved ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/prospects/${pin.saved.prospectId}`} className="btn-primary inline-flex items-center px-4 py-2 text-[15px]" data-testid="card-open-prospect">
              {CARD_TEXT.openProspect}
            </Link>
            <span className="text-[14px] text-fg-muted">{fill(CARD_TEXT.alreadySaved, { reference: pin.saved.reference })}</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => setAdding(true)} disabled={adding || pin.hidden === true} data-testid="google-add-by-url" aria-expanded={adding}>
                {GOOGLE_TEXT.addByWebsite}
              </Button>
              <Button onClick={onDismiss} disabled={pin.hidden === true} data-testid="card-dismiss">
                {CARD_TEXT.notThisOne}
              </Button>
            </div>
            <p className="text-[14px] text-fg-muted">{pin.hidden ? CARD_TEXT.hidden : GOOGLE_TEXT.needsWebsite}</p>
          </>
        )}
      </div>
    </div>
  );
}
