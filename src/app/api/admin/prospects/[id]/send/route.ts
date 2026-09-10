import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { SendError, sendOutreach, sendPanelState } from "@/lib/outreach/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function prospectId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 && String(id) === raw ? id : null;
}

function fail(e: unknown): NextResponse {
  if (e instanceof SendError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
  console.error("send route failed", (e as { code?: string }).code ?? (e as Error).name);
  return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
}

/** SendPanel state: recipient, sender, draft, refusals as things stand, legal block preview, cap, recent sends. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = prospectId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...sendPanelState(id) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Send the reviewed draft (`{ draftId? }`, default the newest). Every refusal
 * comes back as 409 with the codes and plain-words reasons — never a 500; an
 * SMTP failure is 502 with the error code only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const id = prospectId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: Record<string, unknown> = {};
  const raw = await req.text();
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
  }
  let draftId: number | null = null;
  if (body.draftId !== undefined && body.draftId !== null) {
    const n = Number(body.draftId);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ ok: false, error: "draft_id" }, { status: 422 });
    draftId = n;
  }
  try {
    const r = await sendOutreach({ prospectId: id, draftId });
    if (r.ok) return NextResponse.json({ ok: true, send: r.send, lead: r.lead });
    if ("refusals" in r) return NextResponse.json({ ok: false, error: "refused", refusals: r.refusals, reference: r.reference }, { status: 409 });
    return NextResponse.json({ ok: false, error: "smtp_failed", code: r.code, reference: r.reference }, { status: 502 });
  } catch (e) {
    return fail(e);
  }
}
