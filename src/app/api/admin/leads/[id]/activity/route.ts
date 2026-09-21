import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { addActivity, getLead, markReplied, recordBounce, updateLead } from "@/lib/inbox/leads";
import { SEND_REFERENCE_RE, callLogSummary, isCallLogOutcome } from "@/lib/inbox/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Five kinds, all of which work with prospect_id NULL (an inbound lead has no
 * prospect, and the lead page may not lose a control over that):
 *   { kind: "note", text }                     — a line on the timeline
 *   { kind: "mark_replied", text? }            — they answered: email_in + the replied stage
 *   { kind: "sent", text? }                    — the reply Radu sent by hand: email_out, and new → contacted
 *   { kind: "call", outcome, text? }           — a call he made: call + phone, no outreach rules
 *   { kind: "bounce", send_reference: "SN-…" } — an outreach send came back
 * The prospect routes (/api/admin/prospects/[id]/{call,manual-send}) keep the
 * outreach rules — calling hours, attempts, screening — for cold calls; this
 * route records what happened on a lead that came to us.
 * 404 on an unknown lead, 422 on a body this cannot read.
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
    case "sent": {
      // The reply left Gmail (or the phone's mail app) — we only ever know it
      // because he says so. `text` is the line for the timeline, subject and
      // all ("Reply sent by hand — Votre check-up numérique (DM-C4DQ3)"); the
      // page builds it, because only the page knows the subject.
      const activity = addActivity({
        leadId: id,
        prospectId: lead.prospectId,
        kind: "email_out",
        channel: "email",
        actor: "admin",
        summary: text || "Reply sent by hand",
      });
      // A lead that was still new has now been contacted; anything further
      // along stays where it is (updateLead writes the stage_change activity).
      const updated = lead.stage === "new" ? updateLead(id, { stage: "contacted" }) : lead;
      return NextResponse.json({ ok: true, activity, lead: updated });
    }
    case "call": {
      if (!isCallLogOutcome(body.outcome)) return NextResponse.json({ ok: false, error: "outcome" }, { status: 422 });
      const activity = addActivity({
        leadId: id,
        prospectId: lead.prospectId,
        kind: "call",
        channel: "phone",
        actor: "admin",
        summary: callLogSummary(body.outcome, text),
        payload: { outcome: body.outcome },
      });
      return NextResponse.json({ ok: true, activity });
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
