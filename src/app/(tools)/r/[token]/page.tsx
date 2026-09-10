import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ADMIN_COOKIE } from "@/lib/crm/auth";
import { REPORT_UI } from "@/content/report";
import { ipFromHeaders, loadReport, logView, shouldLogView } from "@/lib/report/view";
import { ReportExpired, ReportPage } from "@/components/report/ReportPage";
import "./report.css";

// The prospect's report (contract §8). Unknown token → the (tools) branded
// 404; past report_expires_at → the expired view with status 200; otherwise
// the report in the audit's language. A view is logged only once the report
// has been sent (report_expires_at set) and only for a real document fetch by
// a non-admin, non-bot, non-prefetch request. Rate limit and noindex headers
// come from the middleware and next.config (foundation).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const data = loadReport(token);
  const robots = { index: false, follow: false };
  if (!data) return { title: "Digital M", robots };
  const ui = REPORT_UI[data.locale];
  return { title: data.expired ? ui.expiredHeading : ui.title.replace("{business}", data.business), robots };
}

export default async function ReportRoute({ params }: Params) {
  const { token } = await params;
  const data = loadReport(token);
  if (!data) notFound();
  if (data.expired) return <ReportExpired data={data} />;
  if (data.audit.reportExpiresAt) {
    const h = await headers();
    const jar = await cookies();
    const get = (name: string) => h.get(name);
    if (shouldLogView(get, jar.get(ADMIN_COOKIE)?.value)) logView(data, ipFromHeaders(get));
  }
  return <ReportPage data={data} />;
}
