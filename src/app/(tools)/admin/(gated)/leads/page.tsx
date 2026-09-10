import type { Metadata } from "next";
import { requireAdmin } from "@/lib/crm/auth";
import { zonedToday } from "@/lib/crm/db";
import { LEAD_SORTS, leadStageCounts, listLeads } from "@/lib/inbox/leads";
import { isLeadKind, isLeadStage } from "@/lib/inbox/stages";
import { AddLeadForm } from "@/components/admin/AddLeadForm";
import { LeadTable, type LeadTableQuery } from "@/components/admin/LeadTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 50;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// /admin/leads — filters come from the query string and are validated against
// the fixed lists before they reach listLeads (identifier allowlist, §0).
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/leads");
  const sp = await searchParams;
  const stageRaw = first(sp.stage);
  const kindRaw = first(sp.kind);
  const sortRaw = first(sp.sort);
  const pageRaw = Number.parseInt(first(sp.page), 10);
  const query: LeadTableQuery = {
    stage: stageRaw === "all" ? "all" : isLeadStage(stageRaw) ? stageRaw : "open",
    kind: isLeadKind(kindRaw) ? kindRaw : "",
    q: first(sp.q).slice(0, 100),
    sort: sortRaw in LEAD_SORTS ? sortRaw : "activity",
    dir: first(sp.dir) === "asc" ? "asc" : "desc",
    page: Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw : 1,
  };
  const { rows, total } = listLeads({
    stage: query.stage,
    kind: isLeadKind(query.kind) ? query.kind : undefined,
    q: query.q,
    sort: query.sort,
    dir: query.dir,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  });
  const [y, m, d] = zonedToday("Europe/Paris");
  const today = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Leads</p>
          <h1 className="mt-1 text-2xl text-fg-heading">Everyone who asked, and everyone we asked</h1>
        </div>
        <AddLeadForm />
      </header>
      <LeadTable rows={rows} total={total} query={query} today={today} pageSize={PAGE_SIZE} stageCounts={leadStageCounts()} />
    </div>
  );
}
