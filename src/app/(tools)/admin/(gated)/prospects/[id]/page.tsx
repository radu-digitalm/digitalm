import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/crm/auth";
import { tradeLabel } from "@/lib/discover/categories";
import { googlePlacesOn } from "@/lib/discover/google";
import { searchSummary } from "@/lib/discover/index";
import { getProspect } from "@/lib/prospects/store";
import { AuditBlock } from "@/components/admin/AuditBlock";
import { CallPanel } from "@/components/admin/CallPanel";
import { DraftPanel } from "@/components/admin/DraftPanel";
import { ExtLink } from "@/components/admin/ExtLink";
import { GoogleBlock } from "@/components/admin/GoogleBlock";
import { MiniMap } from "@/components/admin/MiniMap";
import { ProspectBadges, anyPhone, usableEmail } from "@/components/admin/ProspectBadges";
import { RegisterBlock } from "@/components/admin/RegisterBlock";
import { SendPanel } from "@/components/admin/SendPanel";
import { WebsiteBlock } from "@/components/admin/WebsiteBlock";
import { countryName, localDate, townParen } from "@/components/admin/format";
import { CARD_TEXT, PROSPECT_TEXT, SOURCE_WORDS, fill } from "@/components/admin/wording";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = Number.parseInt((await params).id, 10);
  const p = Number.isInteger(id) ? getProspect(id) : null;
  return { title: p ? `${p.reference} · ${p.name}` : "Prospect" };
}

/** The search that found this prospect, for the "Found by the search …" line. */
function foundBy(searchId: number | null): { area: string; trade: string; createdAt: string } | null {
  if (!searchId) return null;
  const s = searchSummary(searchId);
  if (!s) return null;
  return { area: s.areaLabel, trade: s.categoryLabel, createdAt: s.createdAt };
}

const pill = "inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-3 py-1 text-[15px] text-fg-heading hover:border-line-strong";

// Header + contact strip + mini map, then Identity & register, Website &
// contact, the audit block, the Google listing section (only while Google is
// on; below the fold, collapsed — docs/finder-google-spec.md §5.6) and the
// three self-loading panels owned by report / outreach.
export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  await requireAdmin(`/admin/prospects/${raw}`);
  const id = Number.parseInt(raw, 10);
  const p = Number.isInteger(id) && id > 0 ? getProspect(id) : null;
  if (!p) notFound();

  const trade = tradeLabel(p.tradeKey);
  const town = townParen(p.postcode, p.city);
  const country = countryName(p.country);
  const phone = anyPhone(p);
  const email = usableEmail(p) ?? p.websiteEmail ?? p.sourceEmail;
  const registerUrl = p.registerId && p.country === "FR" ? `https://annuaire-entreprises.data.gouv.fr/etablissement/${p.registerId}` : p.registerId && p.country === "GB" ? `https://find-and-update.company-information.service.gov.uk/company/${p.registerId}` : null;
  const osmUrl = p.source === "osm" && p.sourceUrl ? p.sourceUrl : p.lat !== null && p.lng !== null ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}` : null;
  const search = foundBy(p.searchId);
  const geoSourceWord = p.geoSource === "centre" ? PROSPECT_TEXT.coordsFrom.centre! : p.geoSource === "manual" ? PROSPECT_TEXT.coordsFrom.manual! : fill(PROSPECT_TEXT.coordsFrom.source!, { source: SOURCE_WORDS[p.source] ?? p.source });
  const addressLines = [p.addressLine, [p.postcode, p.city].filter(Boolean).join(" "), p.region, country].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">
          <Link href="/admin/prospects" className="hover:underline">
            Prospects
          </Link>{" "}
          · <span className="font-mono">{p.reference}</span>
        </p>
        <h1 className="break-words text-[26px] text-fg-heading">{p.name}</h1>
        <p className="text-[15px] text-fg-muted">
          {[trade, [town, country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
          {p.leadId ? (
            <>
              {" · "}
              <Link href={`/admin/leads/${p.leadId}`} className="link-accent">
                lead
              </Link>
            </>
          ) : null}
        </p>
        <ProspectBadges prospect={p} />
        <div className="flex flex-wrap gap-2 pt-1" data-testid="contact-strip">
          {phone ? (
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={pill}>
              {phone}
            </a>
          ) : null}
          {email ? (
            <a href={`mailto:${email}`} className={`${pill} break-all`}>
              {email}
            </a>
          ) : null}
          {p.website ? <ExtLink href={p.website} className={pill} /> : null}
          {osmUrl ? (
            <ExtLink href={osmUrl} className={pill}>
              {CARD_TEXT.openOsm}
            </ExtLink>
          ) : null}
          {registerUrl ? (
            <ExtLink href={registerUrl} className={pill}>
              {p.country === "GB" ? "Open at Companies House" : "Open in the register"}
            </ExtLink>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {p.lat !== null && p.lng !== null ? (
          <div>
            <MiniMap lat={p.lat} lng={p.lng} name={p.name} />
            <p className="mt-1 text-[14px] text-fg-muted">{geoSourceWord}</p>
          </div>
        ) : null}
        <div className="space-y-2 text-[15px]">
          {addressLines.length > 0 ? (
            <address className="not-italic text-fg">
              {addressLines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </address>
          ) : (
            <p className="text-fg-muted">No address on file.</p>
          )}
          {search ? (
            <p className="text-fg-muted">
              {`${fill(PROSPECT_TEXT.foundBy, { area: search.area, trade: search.trade, date: localDate(search.createdAt) })} — `}
              <Link href={`/admin/find?search=${p.searchId}`} className="link-accent">
                {PROSPECT_TEXT.open}
              </Link>
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RegisterBlock prospect={p} />
        <WebsiteBlock prospect={p} />
      </div>

      <AuditBlock prospectId={p.id} />
      <GoogleBlock prospect={p} enabled={googlePlacesOn()} />
      <DraftPanel prospectId={p.id} />
      <SendPanel prospectId={p.id} />
      <CallPanel prospectId={p.id} />
    </div>
  );
}
