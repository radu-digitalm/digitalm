import type { Metadata } from "next";
import { requireAdmin } from "@/lib/crm/auth";
import { countViews, listProspects } from "@/lib/prospects/store";
import { AddByUrl } from "@/components/admin/AddByUrl";
import { ProspectTable } from "@/components/admin/ProspectTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Prospects" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Views ready / call / all / not_fit (READY_WHERE, CALL_WHERE), badges,
// bulk "Audit next 20", Add by URL.
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Outreach</p>
          <h1 className="mt-1 text-2xl text-fg-heading">Prospects</h1>
          <p className="mt-1 text-sm text-fg-muted">Ready to send = audited under the threshold, usable business email, inside the country rules. Everything else waits for an audit, a phone call or a decision.</p>
        </div>
      </header>
      <AddByUrl />
      <ProspectTable rows={rows} view={view} counts={counts} q={q} sort={sort} dir={dir} />
    </div>
  );
}
