import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { cancelJob, enqueue, getJob, jobStatus, requeueJob } from "@/lib/crm/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Queue status: counts by state and the most recent rows (payloads, never results). */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);
  return NextResponse.json({ ok: true, ...jobStatus(Number.isFinite(limit) ? limit : 50) });
}

/**
 * { action: "requeue" | "cancel", id } — put a failed/cancelled job back or
 * cancel a queued one. { action: "noop" } enqueues a no-op job to prove the
 * runner is alive (the acceptance test's "done within 10 s").
 */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const action = body.action;
  if (action === "noop") {
    const { id, deduped } = enqueue("noop", { requestedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, id, deduped });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }
  if (action === "requeue") {
    const changed = requeueJob(id);
    return NextResponse.json({ ok: true, changed, job: getJob(id) });
  }
  if (action === "cancel") {
    const changed = cancelJob(id);
    return NextResponse.json({ ok: true, changed, job: getJob(id) });
  }
  return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
}
