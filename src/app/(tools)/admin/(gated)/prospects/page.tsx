import type { Metadata } from "next";
import { requireAdmin } from "@/lib/crm/auth";
import { countViews, listProspects } from "@/lib/prospects/store";
import { ProspectTable } from "@/components/admin/ProspectTable";
import { PROSPECT_TEXT } from "@/components/admin/wording";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Prospects" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Views ready / call / all / not_fit (READY_WHERE, CALL_WHERE), badges as
// words, More menu (Audit next 20, Fill in missing towns), Add by website.
export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/prospects");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const sort = one(sp.sort) || "saved";
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const { view, rows } = listProspects({ view: one(sp.view) || "ready", q, sort, dir });
  const counts = countViews();

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Outreach</p>
        <h1 className="mt-1 text-[26px] text-fg-heading">Prospects</h1>
        <p className="mt-1 max-w-prose text-[15px] text-fg-muted">{PROSPECT_TEXT.intro}</p>
      </header>
      <ProspectTable rows={rows} view={view} counts={counts} q={q} sort={sort} dir={dir} />
    </div>
  );
}
