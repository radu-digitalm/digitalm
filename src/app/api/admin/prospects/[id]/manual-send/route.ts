import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { SendError, cancelManualSend, prepareManualSend, recordManualSend, repairSentEffects } from "@/lib/outreach/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function prospectId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 && String(id) === raw ? id : null;
}

function fail(e: unknown): NextResponse {
  if (e instanceof SendError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
  console.error("manual-send route failed", (e as { code?: string }).code ?? (e as Error).name);
  return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
}

/**
 * The Gmail path (contract §9 "Manual send"):
 *   { action: "prepare", draftId?: number | "followup" } → the same refusals as an in-app send, then a pending
 *     manual_email row and the text to paste (body + legal block with the opt-out link resolved);
 *   { action: "record", sendId } → the row becomes sent with the prospect / lead / audit effects (409 unless prepared);
 *     `warning: "bookkeeping_failed"` when those effects failed after the row was marked sent;
 *   { action: "cancel", sendId } → a pending row (prepared and never pasted, or stuck in flight) is closed as failed/cancelled;
 *   { action: "repair", sendId } → re-runs the bookkeeping of a sent row (idempotent; 409 unless sent).
 * Refusals answer 409 with `error` in plain words: the lead page shows that string as-is.
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

  try {
    switch (body.action) {
      case "prepare": {
        let draftId: number | "followup" | null = null;
        if (body.draftId === "followup") draftId = "followup";
        else if (body.draftId !== undefined && body.draftId !== null) {
          const n = Number(body.draftId);
          if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ ok: false, error: "draft_id" }, { status: 422 });
          draftId = n;
        }
        const r = await prepareManualSend(id, draftId);
        if ("refusals" in r) {
          return NextResponse.json(
            { ok: false, error: r.refusals.map((x) => x.message.en).join(" "), code: "refused", refusals: r.refusals, reference: r.reference },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true, ...r });
      }
      case "record":
      case "cancel":
      case "repair": {
        const sendId = Number(body.sendId);
        if (!Number.isInteger(sendId) || sendId <= 0) return NextResponse.json({ ok: false, error: "send_id" }, { status: 422 });
        if (body.action === "cancel") return NextResponse.json({ ok: true, send: cancelManualSend(sendId, id) });
        if (body.action === "repair") {
          const r = repairSentEffects(sendId, id);
          return NextResponse.json({ ok: true, send: r.send, lead: r.lead });
        }
        const r = recordManualSend(sendId, id);
        return NextResponse.json({ ok: true, send: r.send, lead: r.lead, warning: r.warning });
      }
      default:
        return NextResponse.json({ ok: false, error: "action" }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
