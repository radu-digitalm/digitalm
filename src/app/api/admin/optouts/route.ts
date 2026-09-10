import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { OptoutError, manualOptout } from "@/lib/outreach/optout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual add to the opposition list (contract §9): `{ email }`, `{ phone, country? }`,
 * `{ lead_id }` / `{ lead_reference }`, `{ prospect_id }` / `{ prospect_reference }`, or
 * `{ send_reference: "SN-XXXXX", source: "reply_stop" }` for a STOP reply. Raw values are
 * hashed at once; the response carries hashes only. "Mark STOP" on a lead or prospect
 * posts here first, then the stage.
 */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const r = manualOptout(body);
    return NextResponse.json({ ok: true, recorded: r.recorded, optout: r.optout, lead: r.lead });
  } catch (e) {
    if (e instanceof OptoutError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    console.error("optouts route failed", (e as { code?: string }).code ?? (e as Error).name);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
