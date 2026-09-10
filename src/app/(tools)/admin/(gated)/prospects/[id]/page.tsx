import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/crm/auth";
import { tradeLabel } from "@/lib/discover/categories";
import { googlePlacesOn } from "@/lib/discover/google";
import { getProspect } from "@/lib/prospects/store";
import { AuditBlock } from "@/components/admin/AuditBlock";
import { CallPanel } from "@/components/admin/CallPanel";
import { DraftPanel } from "@/components/admin/DraftPanel";
import { GoogleBlock } from "@/components/admin/GoogleBlock";
import { ProspectBadges } from "@/components/admin/ProspectBadges";
import { RegisterBlock } from "@/components/admin/RegisterBlock";
import { SendPanel } from "@/components/admin/SendPanel";
import { WebsiteBlock } from "@/components/admin/WebsiteBlock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = Number.parseInt((await params).id, 10);
  const p = Number.isInteger(id) ? getProspect(id) : null;
  return { title: p ? `${p.reference} · ${p.name}` : "Prospect" };
}

// Register, website and Google blocks (finder) plus the four self-loading
// panels owned by audit / report / outreach — composed with { prospectId }
// only, so this page imports none of their libs.
export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  await requireAdmin(`/admin/prospects/${raw}`);
  const id = Number.parseInt(raw, 10);
  const p = Number.isInteger(id) && id > 0 ? getProspect(id) : null;
  if (!p) notFound();

  const trade = tradeLabel(p.tradeKey);
  const town = [p.postcode, p.city].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">
            <Link href="/admin/prospects" className="hover:underline">
              Prospects
            </Link>{" "}
            · <span className="font-mono">{p.reference}</span>
          </p>
          <h1 className="mt-1 break-words text-2xl text-fg-heading">{p.name}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {[trade, town, p.country].filter(Boolean).join(" · ")}
            {p.leadId ? (
              <>
                {" · "}
                <Link href={`/admin/leads/${p.leadId}`} className="link-accent">
                  lead
                </Link>
              </>
            ) : null}
          </p>
          <ProspectBadges prospect={p} className="mt-2" />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <RegisterBlock prospect={p} />
        <WebsiteBlock prospect={p} />
      </div>

      <GoogleBlock prospect={p} enabled={googlePlacesOn()} />

      <AuditBlock prospectId={p.id} />
      <DraftPanel prospectId={p.id} />
      <SendPanel prospectId={p.id} />
      <CallPanel prospectId={p.id} />
    </div>
  );
}
