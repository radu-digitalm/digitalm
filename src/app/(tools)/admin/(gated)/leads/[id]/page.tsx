import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/crm/auth";
import { getEnquirySummary, getLead, getLeadByReference, getProspectSummary, listActivities } from "@/lib/inbox/leads";
import { LEAD_REFERENCE_RE } from "@/lib/inbox/stages";
import { LeadDetail } from "@/components/admin/LeadDetail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Lead" };

// /admin/leads/[id] — accepts the numeric id or the LD- reference (the one the
// Telegram pings carry). Unknown → the branded (tools) 404.
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  await requireAdmin(`/admin/leads/${encodeURIComponent(raw)}`);
  const upper = raw.toUpperCase();
  const numeric = Number(raw);
  const lead = LEAD_REFERENCE_RE.test(upper) ? getLeadByReference(upper) : Number.isInteger(numeric) && numeric > 0 ? getLead(numeric) : null;
  if (!lead) notFound();
  const activities = listActivities(lead.id, lead.prospectId);
  const prospect = lead.prospectId !== null ? getProspectSummary(lead.prospectId) : null;
  const enquiry = lead.enquiryReference ? getEnquirySummary(lead.enquiryReference) : null;
  return <LeadDetail lead={lead} activities={activities} prospect={prospect} enquiry={enquiry} />;
}
