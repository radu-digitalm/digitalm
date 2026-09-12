import type { Metadata } from "next";
import { requireAdmin } from "@/lib/crm/auth";
import { CATEGORIES } from "@/lib/discover/index";
import { companiesHouseKey } from "@/lib/discover/companiesHouse";
import { googlePlacesOn } from "@/lib/discover/google";
import { FindWorkspace } from "@/components/admin/FindWorkspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Find" };

// Map-first finder (docs/finder-ux-spec.md §5): the client workspace owns the
// search, the polling, the map and the list; past searches load client-side
// from /api/admin/find/recent. ?search=ID re-opens a search from its 24 h cache.
export default async function FindPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/find");
  const sp = await searchParams;
  const raw = Array.isArray(sp.search) ? sp.search[0] : sp.search;
  const initialSearchId = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
  const trades = CATEGORIES.map((c) => ({ key: c.key, label: c.label }));

  return (
    <div className="find-wide">
      <h1 className="sr-only">Find businesses</h1>
      <FindWorkspace trades={trades} initialSearchId={initialSearchId} companiesHouseOn={companiesHouseKey() !== null} googleOn={googlePlacesOn()} />
    </div>
  );
}
