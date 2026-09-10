import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { DraftError, createDraft, draftPanelState } from "@/lib/drafts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function prospectId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(e: unknown): NextResponse {
  if (e instanceof DraftError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
  console.error("draft route failed", (e as { code?: string }).code ?? (e as Error).name);
  return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
}

/** DraftPanel state: prospect display name, latest finished audit, newest draft, caps. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = prospectId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...draftPanelState(id) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Generate (or regenerate) the four-field draft for the prospect's latest
 * finished audit: a new drafts row each time, model when OPENAI_API_KEY is
 * set and the output passes the guards, template otherwise. 409 audit_missing
 * without a finished audit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const id = prospectId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  // The body is optional and carries nothing today; a malformed one is still a 400.
  const raw = await req.text();
  if (raw.trim()) {
    try {
      JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
  }
  try {
    const { reason, ...draft } = await createDraft(id);
    return NextResponse.json({ ok: true, draft, fallback: draft.fallback, reason });
  } catch (e) {
    return fail(e);
  }
}
