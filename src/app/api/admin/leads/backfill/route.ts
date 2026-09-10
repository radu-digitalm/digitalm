import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { backfillEnquiries } from "@/lib/inbox/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotent: creates a diagnostic lead for every enquiry without one; a second call returns {created: 0}. */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const result = backfillEnquiries();
  return NextResponse.json({ ok: true, ...result });
}
