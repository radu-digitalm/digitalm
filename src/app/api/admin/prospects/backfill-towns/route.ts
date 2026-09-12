import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { backfillTowns } from "@/lib/prospects/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

/**
 * {} → fill `city` on prospects saved with coordinates but no town
 * (docs/finder-ux-spec.md §3.8): French rows through geo.gouv, others through
 * the commune containing the point on OpenStreetMap (≤ 20 per call).
 * Idempotent; ≤ 200 rows per call; returns { filled, remaining }.
 */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  try {
    const r = await backfillTowns();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("prospects/backfill-towns failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "backfill_failed" }, { status: 500 });
  }
}
