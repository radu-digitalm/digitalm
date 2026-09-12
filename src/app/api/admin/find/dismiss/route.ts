import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { RunnerError, dismissSearchRow } from "@/lib/discover/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** { searchId, key, undo? } → "Not this one", remembered on the server (docs/finder-ux-spec.md §3.7, §4). */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const searchId = Number(body.searchId);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!Number.isInteger(searchId) || searchId <= 0) return NextResponse.json({ ok: false, error: "bad_search_id" }, { status: 400 });
  if (!key || key.length > 80) return NextResponse.json({ ok: false, error: "bad_key" }, { status: 400 });
  try {
    const { hidden } = dismissSearchRow(searchId, key, body.undo === true);
    return NextResponse.json({ ok: true, hidden });
  } catch (e) {
    if (e instanceof RunnerError) return NextResponse.json({ ok: false, error: e.code, ...(e.detail ?? {}) }, { status: e.status });
    console.error("find/dismiss failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "dismiss_failed" }, { status: 500 });
  }
}
