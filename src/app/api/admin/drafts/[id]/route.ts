import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { DraftError, readDraftEdits, saveDraft } from "@/lib/drafts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save edits to a draft: { subject?, body?, callScript?, noteForOwner? }.
 * Sets edited_at when something changed and reviewed_at always — this is the
 * review gate outreach checks before a send (draft_unreviewed until then).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const draft = saveDraft(id, readDraftEdits(body));
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    if (e instanceof DraftError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    console.error("draft save failed", (e as { code?: string }).code ?? (e as Error).name);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
