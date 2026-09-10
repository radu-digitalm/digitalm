import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { addActivity, getLead, markReplied, recordBounce } from "@/lib/inbox/leads";
import { SEND_REFERENCE_RE } from "@/lib/inbox/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only three kinds (contract §5): { kind: "note", text } · { kind: "mark_replied", text? }
 * · { kind: "bounce", send_reference: "SN-XXXXX" }. Calls and manual sends are
 * outreach's: the lead page posts those to /api/admin/prospects/[id]/{call,manual-send}.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";

  switch (body.kind) {
    case "note": {
      if (!text) return NextResponse.json({ ok: false, error: "text" }, { status: 422 });
      const activity = addActivity({ leadId: id, prospectId: lead.prospectId, kind: "note", summary: text, actor: "admin" });
      return NextResponse.json({ ok: true, activity });
    }
    case "mark_replied": {
      const updated = markReplied(id, text || null);
      return NextResponse.json({ ok: true, lead: updated });
    }
    case "bounce": {
      const ref = typeof body.send_reference === "string" ? body.send_reference.trim().toUpperCase() : "";
      if (!SEND_REFERENCE_RE.test(ref)) return NextResponse.json({ ok: false, error: "send_reference" }, { status: 422 });
      const activity = recordBounce(id, ref);
      if (!activity) return NextResponse.json({ ok: false, error: "send_not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, activity });
    }
    default:
      return NextResponse.json({ ok: false, error: "kind" }, { status: 400 });
  }
}
