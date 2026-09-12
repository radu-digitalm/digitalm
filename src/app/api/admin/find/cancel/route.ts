import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { RunnerError, cancelSearch } from "@/lib/discover/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** { searchId } → stop a running search; rows found so far are kept (docs/finder-ux-spec.md §4). Idempotent. */
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
  if (!Number.isInteger(searchId) || searchId <= 0) return NextResponse.json({ ok: false, error: "bad_search_id" }, { status: 400 });
  try {
    const { status } = await cancelSearch(searchId);
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    if (e instanceof RunnerError) return NextResponse.json({ ok: false, error: e.code, ...(e.detail ?? {}) }, { status: e.status });
    console.error("find/cancel failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "cancel_failed" }, { status: 500 });
  }
}
