import type { Metadata } from "next";
import { allowedKey } from "@/lib/crm/allowlist";
import { requireAdmin } from "@/lib/crm/auth";
import { OPTOUT_SORTS, listOptouts } from "@/lib/outreach/optout";
import { OptoutTable } from "@/components/admin/OptoutTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Opt-outs" };

const PAGE_SIZE = 100;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// /admin/optouts — the opposition list (contract §9): hashes, channel, source,
// date and links, plus the manual add form. Sort keys come from the fixed
// allowlist; the list never shows an address.
export default async function OptoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/optouts");
  const sp = await searchParams;
  const sort = allowedKey(OPTOUT_SORTS, first(sp.sort), "created");
  const pageRaw = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw : 1;
  const { rows, total } = listOptouts({ sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Opt-outs</p>
        <h1 className="mt-1 text-2xl text-fg-heading">Opposition list</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Checked before every send and every call. Email and phone are stored as hashes only, and this list is never purged — that is what keeps a
          STOP a STOP.
        </p>
      </header>
      <OptoutTable rows={rows} total={total} page={page} pageSize={PAGE_SIZE} sort={sort} />
    </div>
  );
}
