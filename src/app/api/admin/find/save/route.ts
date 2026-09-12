import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { ProspectError, saveFromSearch } from "@/lib/prospects/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The exact-commune lookups (≤ 100 per save, 200 ms apart) fit under nginx's 60 s.
export const maxDuration = 55;

/**
 * { searchId, picks: string[] } — save the ticked rows of a cached search:
 * 30-day notice deadline on every row, audits enqueued for rows with a
 * website, the exact commune looked up for French rows whose town was
 * approximate. 422 { error: "partial_diffusion", picks } for non-diffusible
 * register rows; 409 { error: "hidden", picks } for dismissed rows; 410 when
 * the search cache has expired. Returns `prospectIds` in the order of `references`.
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
  const searchId = Number(body.searchId);
  if (!Number.isInteger(searchId) || searchId <= 0) return NextResponse.json({ ok: false, error: "bad_search_id" }, { status: 400 });
  const picks = Array.isArray(body.picks) ? body.picks.filter((p): p is string => typeof p === "string" && p.length <= 80).slice(0, 300) : [];
  if (picks.length === 0) return NextResponse.json({ ok: false, error: "no_picks" }, { status: 400 });
  try {
    const result = await saveFromSearch(searchId, picks);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof ProspectError) {
      const detail = e.detail && typeof e.detail === "object" ? (e.detail as Record<string, unknown>) : {};
      return NextResponse.json({ ok: false, error: e.code, ...detail }, { status: e.status });
    }
    console.error("find/save failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }
}
