import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { enquiriesDb } from "@/lib/enquiries";
import { addActivity, getLead, markReplied, recordBounce, updateLead } from "@/lib/inbox/leads";
import { SEND_REFERENCE_RE, activitySummary, callLogSummary, isCallLogOutcome } from "@/lib/inbox/stages";

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
 *
 * 404 on an unknown lead, 400 on a body or a kind this cannot read, 422 on a
 * value it can read and cannot use. Every one of those codes has a sentence in
 * LEAD_ERROR_WORDS (lib/inbox/stages.ts): the code is for the log, and the
 * caller shows the sentence, because a route code on Radu's screen is a banned
 * token (components/admin/wording.ts §7).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    // `null` and `[…]` parse, and neither has keys: caught here, because
    // `body.text` on null throws and a 500 with an empty body is a toast with
    // nothing in it.
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad_request");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";

  switch (body.kind) {
    case "note": {
      if (!text) return NextResponse.json({ ok: false, error: "text" }, { status: 422 });
      const activity = addActivity({ leadId: id, prospectId: lead.prospectId, kind: "note", summary: activitySummary(text), actor: "admin" });
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
      // One transaction around both writes (better-sqlite3 nests them as
      // savepoints): the row and the stage land together, or neither does —
      // an "Email sent" line on a lead still reading New is a lie the page
      // would then show for good.
      const done = enquiriesDb().transaction(() => {
        const activity = addActivity({
          leadId: id,
          prospectId: lead.prospectId,
          kind: "email_out",
          channel: "email",
          actor: "admin",
          summary: activitySummary(text || "Reply sent by hand"),
        });
        // A lead that was still new has now been contacted; anything further
        // along stays where it is (updateLead writes the stage_change activity).
        const updated = lead.stage === "new" ? updateLead(id, { stage: "contacted" }) : lead;
        return { activity, updated };
      })();
      return NextResponse.json({ ok: true, activity: done.activity, lead: done.updated });
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
