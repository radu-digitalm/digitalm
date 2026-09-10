import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { auditNext } from "@/lib/prospects/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Enqueue up to 20 audit jobs for prospects with a website and no audit in
 * the last 90 days (deduped on "audit:{id}"). { limit?: 1–20 }.
 */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body means the default of 20 */
  }
  const limit = Number.parseInt(String(body.limit ?? "20"), 10);
  const result = auditNext(Number.isFinite(limit) ? limit : 20);
  return NextResponse.json({ ok: true, ...result });
}
