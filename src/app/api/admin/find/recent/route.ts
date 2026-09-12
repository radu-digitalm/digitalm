import { NextRequest, NextResponse } from "next/server";
import { isResponse, requireAdminApi } from "@/lib/crm/auth";
import { listSearches } from "@/lib/discover/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?limit=20 → past searches with their status (docs/finder-ux-spec.md §5.7); dates are ISO, formatting is client-side. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const raw = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isInteger(raw) ? Math.max(1, Math.min(100, raw)) : 20;
  return NextResponse.json({ ok: true, searches: listSearches(limit) });
}
