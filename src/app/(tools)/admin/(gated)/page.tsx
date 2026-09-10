import type { Metadata } from "next";
import { requireAdmin } from "@/lib/crm/auth";
import { collectToday, summariseToday } from "@/lib/inbox/today";
import { TodayCards } from "@/components/admin/TodayCards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Today" };

// /admin — the gate is this page's requireAdmin() call (contract §3), never the layout.
export default async function TodayPage() {
  await requireAdmin("/admin");
  const data = await collectToday();
  const cards = summariseToday(data);
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Today · {data.today}</p>
        <h1 className="mt-1 text-2xl text-fg-heading">What needs doing</h1>
      </header>
      <TodayCards cards={cards} />
    </div>
  );
}
