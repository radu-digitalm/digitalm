import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { CallError, callPanelState, isCallOutcome, logCall } from "@/lib/outreach/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function prospectId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 && String(id) === raw ? id : null;
}

function fail(e: unknown): NextResponse {
  if (e instanceof CallError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
  console.error("call route failed", (e as { code?: string }).code ?? (e as Error).name);
  return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
}

/** CallPanel state: window in the rule's time zone, attempts n/4, screening, openers, the draft's script. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = prospectId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...callPanelState(id) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Log one call: `{ outcome, note?, tpsChecked? }`. Register re-check (24 h),
 * opposition list, hours, 4/30 d and GB screening run first; a refusal is 409
 * with `error` in plain words (the lead page shows it as-is) and the codes.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const id = prospectId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (!isCallOutcome(body.outcome)) return NextResponse.json({ ok: false, error: "outcome" }, { status: 422 });
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  const tpsChecked = body.tpsChecked === true;
  try {
    const r = await logCall({ prospectId: id, outcome: body.outcome, note, tpsChecked });
    if (r.ok) return NextResponse.json({ ok: true, activityId: r.activityId, lead: r.lead, optedOut: r.optedOut });
    return NextResponse.json({ ok: false, error: r.refusals.map((x) => x.message.en).join(" "), code: "refused", refusals: r.refusals }, { status: 409 });
  } catch (e) {
    return fail(e);
  }
}
