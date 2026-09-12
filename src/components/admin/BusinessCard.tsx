"use client";

// The business card (docs/finder-ux-spec.md §5.5): everything the finder knows
// about one row in plain sentences, with Save & audit / Not this one. Rendered
// as an overlay over the list pane (desktop), a right sheet (tablet) or a
// full-height sheet (phone). role="dialog" named by the business name; Esc
// closes and the workspace returns focus to the row.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { hasPin, unsavableReason, type ResolvedArea, type ResultRow } from "./finderApi";
import { Button } from "./Button";
import { ExtLink } from "./ExtLink";
import { formatKm, googleSearchUrl, localDate, openingHoursWords, townLine } from "./format";
import { CARD_TEXT, FIND_TEXT, fill, legalFormWords } from "./wording";

export type CardLayout = "overlay" | "sheet" | "full";

export type BusinessCardProps = {
  row: ResultRow;
  area: ResolvedArea;
  trade: string;
  layout: CardLayout;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onDismiss: () => void;
  onShowOnMap?: () => void;
};

const SOCIAL_WORD: Record<string, string> = { facebook: CARD_TEXT.facebook, instagram: CARD_TEXT.instagram, linkedin: CARD_TEXT.linkedin, twitter: CARD_TEXT.twitter, x: CARD_TEXT.twitter };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[15px] font-medium uppercase tracking-wide text-fg-muted">{title}</h3>
      <div className="space-y-1 text-[16px] text-fg">{children}</div>
    </section>
  );
}

/** What OpenStreetMap says about the business itself: cuisine, hours, a description. */
function aboutLines(r: ResultRow): React.ReactNode[] {
  const tags = r.tags ?? {};
  const out: React.ReactNode[] = [];
  const cuisine = tags.cuisine
    ?.split(";")
    .map((c) => c.trim().replace(/_/g, " "))
    .filter(Boolean)
    .join(", ");
  if (cuisine) out.push(<p key="cuisine">{fill(CARD_TEXT.cuisine, { v: cuisine })}</p>);
  const hours = openingHoursWords(tags.opening_hours);
  if (hours) out.push(<p key="hours">{fill(CARD_TEXT.openingHours, { v: hours })}</p>);
  if (tags.description) out.push(<p key="description" className="text-fg-muted">{tags.description}</p>);
  return out;
}

function registerSentences(r: ResultRow): React.ReactNode {
  if (r.source === "companies_house" || (r.registerId && r.countryCode === "GB")) {
    return <p>{fill(CARD_TEXT.companiesHouse, { number: r.registerId ?? "", status: r.active === false ? CARD_TEXT.closed : CARD_TEXT.active })}</p>;
  }
  if (!r.registerId) return <p className="text-fg-muted">{CARD_TEXT.notMatched}</p>;
  const form = legalFormWords(r.legalForm);
  const state = r.active === false ? CARD_TEXT.closed : CARD_TEXT.active;
  const sentence = r.legalName && r.legalName !== r.name ? fill(CARD_TEXT.listedRegister, { legalName: r.legalName, siret: r.registerId, form, state }) : fill(CARD_TEXT.listedRegisterShort, { siret: r.registerId, form, state });
  const registerUrl = r.source === "fr_register" ? r.sourceUrl : `https://annuaire-entreprises.data.gouv.fr/etablissement/${r.registerId}`;
  return (
    <>
      <p>{sentence}</p>
      {r.diffusion === "partial" ? null : <p className="text-fg-muted">{CARD_TEXT.publiclyListed}</p>}
      <p>
        <ExtLink href={registerUrl}>{CARD_TEXT.openRegister}</ExtLink>
      </p>
    </>
  );
}

function originSentences(r: ResultRow): React.ReactNode {
  const osm = r.sources.includes("osm");
  const reg = r.sources.includes("fr_register");
  const ch = r.sources.includes("companies_house");
  const osmId = r.source === "osm" ? r.sourceId : r.sources.includes("osm") && r.provenance.name === "osm" ? r.sourceId : null;
  const lines: React.ReactNode[] = [];
  if (osm && reg) lines.push(<p key="both">{CARD_TEXT.fromBoth}</p>);
  if (osm) {
    const [type, id] = (osmId ?? r.sourceId ?? "").split("/");
    lines.push(
      <p key="osm">
        {fill(CARD_TEXT.fromOsm, { type: type || "element", id: id || "", date: r.readAt ? localDate(r.readAt) : "today" })}
        {r.source === "osm" ? (
          <>
            {" · "}
            <ExtLink href={r.sourceUrl}>{CARD_TEXT.openOsm}</ExtLink>
          </>
        ) : null}
      </p>,
    );
  }
  if (reg && !osm) lines.push(<p key="reg">{CARD_TEXT.fromRegister}</p>);
  if (ch) lines.push(<p key="ch">{CARD_TEXT.fromCompaniesHouse}</p>);
  if (r.sources.includes("google")) lines.push(<p key="g">{CARD_TEXT.fromGoogle}</p>);
  return lines;
}

export function BusinessCard({ row: r, area, trade, layout, saving, onClose, onSave, onDismiss, onShowOnMap }: BusinessCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const titleId = `card-title-${r.key.replace(/[^a-z0-9]/gi, "-")}`;

  useEffect(() => {
    heading.current?.focus();
  }, [r.key]);

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

  const reason = unsavableReason(r);
  const pin = hasPin(r);
  const town = townLine(r.postcode, r.city);
  const hasAddress = !!r.addressLine?.trim();
  const socials = Object.entries(r.socials ?? {}).filter(([, v]) => !!v);
  const km = formatKm(r.distanceKm);
  const about = aboutLines(r);
  const googleQuery = [r.name, r.city].filter(Boolean).join(" ");

  const frame =
    layout === "overlay"
      ? "absolute inset-y-0 right-0 z-20 w-[420px] max-w-full border-l border-line bg-surface shadow-2xl"
      : layout === "sheet"
        ? "fixed inset-y-0 right-0 z-50 w-[420px] max-w-full border-l border-line bg-surface shadow-2xl"
        : "fixed inset-0 z-50 bg-surface";

  return (
    <div ref={root} role="dialog" aria-modal={layout !== "overlay"} aria-labelledby={titleId} data-testid="business-card" className={`${frame} flex flex-col`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Button size="sm" onClick={onClose} aria-label={layout === "full" ? FIND_TEXT.close : FIND_TEXT.back}>
          {layout === "full" ? FIND_TEXT.close : `← ${FIND_TEXT.back}`}
        </Button>
        <span className="flex-1" />
        {onShowOnMap && pin ? (
          <Button size="sm" onClick={onShowOnMap}>
            {FIND_TEXT.showOnMap}
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="h-full space-y-5 overflow-y-auto px-4 pb-10 pt-4">
          <header>
            <h2 id={titleId} ref={heading} tabIndex={-1} className="break-words text-[22px] leading-tight text-fg-heading outline-none">
              {r.name}
            </h2>
            <p className="mt-1 text-[16px] text-fg-muted">
              {trade}
              {r.brand ? ` · ${fill(CARD_TEXT.chain, { brand: r.brand })}` : ""}
            </p>
          </header>

          <Section title={CARD_TEXT.where}>
            {hasAddress ? <p>{r.addressLine}</p> : null}
            <p>
              {town ? (r.cityApprox && r.city ? fill(CARD_TEXT.nearTownNoStreet, { town: r.city }) : town) : <span className="text-fg-muted">{FIND_TEXT.townUnknown}</span>}
            </p>
            <p>
              {r.countryName || r.countryCode}
              {r.countrySource === "area" ? <span className="text-fg-muted"> {CARD_TEXT.countryAssumed}</span> : null}
            </p>
            {r.inside === "no" ? <p className="text-amber-300">{fill(FIND_TEXT.outsideArea, { area: area.label })}</p> : null}
            {km ? <p className="text-fg-muted">{fill(CARD_TEXT.distance, { km, area: area.label })}</p> : null}
            {pin ? (
              <p className="flex flex-wrap gap-x-3 gap-y-1">
                <a href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}`} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
                  {CARD_TEXT.openOsm}
                </a>
                <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
                  {CARD_TEXT.openGoogleMaps}
                </a>
              </p>
            ) : (
              <p className="text-fg-muted">{FIND_TEXT.notOnMap}</p>
            )}
          </Section>

          {about.length > 0 ? <Section title={CARD_TEXT.about}>{about}</Section> : null}

          {r.phone || r.email || r.website || socials.length > 0 ? (
            <Section title={CARD_TEXT.contact}>
              {r.phone ? (
                <p>
                  <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="link-accent whitespace-nowrap">
                    {r.phone}
                  </a>
                </p>
              ) : null}
              {r.email ? (
                <p className="break-all">
                  <a href={`mailto:${r.email}`} className="link-accent">
                    {r.email}
                  </a>
                </p>
              ) : null}
              {r.website ? (
                <p>
                  <ExtLink href={r.website} />
                </p>
              ) : null}
              {socials.length > 0 ? (
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {socials.map(([k, v]) => (
                    <ExtLink key={k} href={v}>
                      {SOCIAL_WORD[k.toLowerCase()] ?? k}
                    </ExtLink>
                  ))}
                </p>
              ) : null}
              <p>
                <a href={googleSearchUrl(googleQuery)} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
                  {fill(CARD_TEXT.searchGoogle, { q: googleQuery })}
                </a>
              </p>
            </Section>
          ) : (
            <Section title={CARD_TEXT.contact}>
              <p>
                <a href={googleSearchUrl(googleQuery)} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
                  {fill(CARD_TEXT.searchGoogle, { q: googleQuery })}
                </a>
              </p>
            </Section>
          )}

          <Section title={CARD_TEXT.register}>{registerSentences(r)}</Section>

          <Section title={CARD_TEXT.origin}>{originSentences(r)}</Section>
        </div>
        {/* The body scrolls under the button bar: a fade says so instead of a sliced line. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
      </div>

      <div className="space-y-2 border-t border-line px-4 py-3">
        {reason === "saved" && r.alreadySaved ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/prospects/${r.alreadySaved.prospectId}`} className="btn-primary inline-flex items-center px-4 py-2 text-[16px]" data-testid="card-open-prospect">
              {CARD_TEXT.openProspect}
            </Link>
            <span className="text-[15px] text-fg-muted">{fill(CARD_TEXT.alreadySaved, { reference: r.alreadySaved.reference })}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={onSave} loading={saving} disabled={reason !== null} data-testid="card-save" title={reason === "not_listed" ? CARD_TEXT.notListedPublicly : reason === "closed" ? CARD_TEXT.closedInRegister : reason === "hidden" ? CARD_TEXT.hidden : undefined}>
              {r.website ? CARD_TEXT.saveAudit : CARD_TEXT.save}
            </Button>
            <Button onClick={onDismiss} disabled={r.hidden === true} data-testid="card-dismiss">
              {CARD_TEXT.notThisOne}
            </Button>
          </div>
        )}
        {reason === null && !r.website ? <p className="text-[15px] text-fg-muted">{CARD_TEXT.noWebsiteToAudit}</p> : null}
        {reason === "not_listed" ? <p className="text-[15px] text-amber-300">{CARD_TEXT.notListedPublicly}</p> : null}
        {reason === "closed" ? <p className="text-[15px] text-fg-muted">{CARD_TEXT.closedInRegister}</p> : null}
        {reason === "hidden" ? <p className="text-[15px] text-fg-muted">{CARD_TEXT.hidden}</p> : null}
      </div>
    </div>
  );
}
