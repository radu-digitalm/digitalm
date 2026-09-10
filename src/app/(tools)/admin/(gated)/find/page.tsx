import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/crm/auth";
import { CATEGORIES, listSearches } from "@/lib/discover/index";
import { companiesHouseKey } from "@/lib/discover/companiesHouse";
import { googlePlacesOn } from "@/lib/discover/google";
import { tradeLabel } from "@/lib/discover/categories";
import { Badge } from "@/components/admin/Badge";
import { FindForm } from "@/components/admin/FindForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Find" };

// Area + trade search across OSM / FR register / Companies House; tick to save.
// Past searches re-open from their 24 h cache (?search=ID).
export default async function FindPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/find");
  const sp = await searchParams;
  const raw = Array.isArray(sp.search) ? sp.search[0] : sp.search;
  const initialSearchId = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
  const past = listSearches(15);
  const categories = CATEGORIES.map((c) => ({ key: c.key, label: c.label.en }));

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Discovery</p>
        <h1 className="mt-1 text-2xl text-fg-heading">Find businesses</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Public sources only — OpenStreetMap, the French register and Companies House. No Maps, Pages Jaunes or social-network scraping. Saving a row starts its 30-day notice clock.
        </p>
      </header>

      <FindForm categories={categories} initialSearchId={initialSearchId} companiesHouseOn={companiesHouseKey() !== null} googleOn={googlePlacesOn()} />

      <section aria-label="Past searches" className="space-y-2">
        <h2 className="text-lg text-fg-heading">Past searches</h2>
        {past.length === 0 ? (
          <p className="text-sm text-fg-muted">No searches yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-faint">
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Area</th>
                  <th className="px-3 py-2 text-left font-medium">Trade</th>
                  <th className="px-3 py-2 text-right font-medium">Found</th>
                  <th className="px-3 py-2 text-right font-medium">Saved</th>
                  <th className="px-3 py-2 text-left font-medium">Sources</th>
                  <th className="px-3 py-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {past.map((s) => (
                  <tr key={s.id} className="border-b border-line/60 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{s.createdAt.slice(0, 16)}</td>
                    <td className="px-3 py-2 text-fg-heading">
                      {s.areaLabel} <span className="text-xs text-fg-faint">{s.countryCode}</span>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{s.categoryKey.startsWith("custom:") ? s.categoryKey : tradeLabel(s.categoryKey) ?? s.categoryKey}</td>
                    <td className="px-3 py-2 text-right font-mono">{s.resultCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{s.savedCount}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {Object.entries(s.perSource)
                        .map(([k, n]) => `${k} ${n}`)
                        .join(" · ")}
                      {s.partial ? <Badge variant="warn" className="ml-2">partial</Badge> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.cached ? (
                        <Link href={`/admin/find?search=${s.id}`} className="link-accent text-xs">
                          open
                        </Link>
                      ) : (
                        <span className="text-xs text-fg-faint">expired</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
