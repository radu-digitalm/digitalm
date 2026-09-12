import type { Metadata } from "next";
import { requireAdmin } from "@/lib/crm/auth";
import { collectToday, summariseToday } from "@/lib/inbox/today";
import { TodayCards, toTodaySummary } from "@/components/admin/TodayCards";
import { localDate } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Today" };

// /admin — the gate is this page's requireAdmin() call (contract §3), never the layout.
// Five action cards + Housekeeping (docs/finder-ux-spec.md §6.5); toTodaySummary()
// accepts the legacy card array until the backend's today.ts lands.
export default async function TodayPage() {
  await requireAdmin("/admin");
  const data = await collectToday();
  const summary = toTodaySummary(summariseToday(data));
  const nextCall = (data as { nextCall?: { id: number; name: string } | null }).nextCall ?? null;
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Today · {localDate(`${data.today} 12:00:00`) || data.today}</p>
        <h1 className="mt-1 text-[26px] text-fg-heading">What needs doing</h1>
      </header>
      <TodayCards summary={summary} nextCall={nextCall} />
    </div>
  );
}
