import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { validEmail } from "@/lib/crm/classify";
import { getLead, mergeLeads, updateLead, type LeadPatch } from "@/lib/inbox/leads";
import { DATE_RE, isLeadStage } from "@/lib/inbox/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function leadId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Patch a lead: { stage?, next_action?, next_action_at?, note?, name?, company?, email?, phone? }
 * or fold another lead into this one: { merge_from: <id> }. Only keys present
 * in the body change; an empty string clears a nullable field. A stage change
 * writes a stage_change activity with {from, to}; a phone change re-hashes the
 * number, so "Fix the number" and the inline phone edit both land here.
 *
 * `country` is deliberately not a key: it is what the phone hash is normalised
 * with, never a fact about the person, so the lead page never shows it and
 * never offers to edit it. The lead page no longer posts `note` either — the
 * customer's own message is read-only there and notes go to the timeline
 * (/activity {kind:"note"}) — but the key stays for the older callers.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const { id: raw } = await params;
  const id = leadId(raw);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    // `null` and `[…]` are valid JSON and neither has keys: read them here,
    // not at `"stage" in body` (which throws, and a 500 with an empty body is
    // a toast with nothing in it).
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad_request");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!getLead(id)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if ("merge_from" in body) {
    const from = leadId(String(body.merge_from));
    if (from === null || from === id) return NextResponse.json({ ok: false, error: "bad_merge" }, { status: 422 });
    const lead = mergeLeads(from, id);
    if (!lead) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, lead });
  }

  const patch: LeadPatch = {};
  const text = (v: unknown): string | null => (typeof v === "string" ? v : v === null ? null : "");
  if ("stage" in body) {
    if (!isLeadStage(body.stage)) return NextResponse.json({ ok: false, error: "stage" }, { status: 422 });
    patch.stage = body.stage;
  }
  if ("next_action" in body) patch.nextAction = text(body.next_action);
  if ("next_action_at" in body) {
    const v = text(body.next_action_at);
    if (v && !DATE_RE.test(v)) return NextResponse.json({ ok: false, error: "next_action_at" }, { status: 422 });
    patch.nextActionAt = v || null;
  }
  if ("note" in body) patch.note = text(body.note);
  if ("name" in body) patch.name = text(body.name);
  if ("company" in body) patch.company = text(body.company);
  if ("email" in body) {
    const v = text(body.email)?.trim() ?? null;
    if (v && !validEmail(v)) return NextResponse.json({ ok: false, error: "email" }, { status: 422 });
    patch.email = v || null;
  }
  if ("phone" in body) patch.phone = text(body.phone);
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "empty" }, { status: 422 });

  const lead = updateLead(id, patch);
  return NextResponse.json({ ok: true, lead });
}
