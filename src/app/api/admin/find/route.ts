import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { HttpError } from "@/lib/crm/http";
import { DiscoverError, geocodeArea, getSearch, parseCategory, parseSources, runSearch, SEARCH_BUDGET_MS } from "@/lib/discover/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Geocode (≤ ~3 s) + adapters (40 s budget) stay under nginx's 60 s read timeout.
export const maxDuration = 55;

/** GET ?id=N — re-read a cached search (24 h) so a page reload keeps the results. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = Number.parseInt(req.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  const result = getSearch(id);
  if (!result) return NextResponse.json({ ok: false, error: "search_expired" }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}

/**
 * { area: string, category: string | { osmKey, osmValue, label?, naf?, sic? },
 *   sources?: DiscoverySource[], hint?: ISO2 }
 * → geocode, run the enabled adapters within the budget, merge, cache 24 h.
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
  const queryArea = typeof body.area === "string" ? body.area.trim() : "";
  if (!queryArea) return NextResponse.json({ ok: false, error: "bad_area" }, { status: 400 });
  const category = parseCategory(body.category);
  if (!category) return NextResponse.json({ ok: false, error: "bad_category" }, { status: 400 });
  const sources = parseSources(body.sources);
  const hint = typeof body.hint === "string" ? body.hint : undefined;

  try {
    const area = await geocodeArea(queryArea, hint);
    const result = await runSearch({ queryArea, area, category, sources, budgetMs: SEARCH_BUDGET_MS });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof DiscoverError) return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: e.status });
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.code }, { status: 502 });
    console.error("find failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "search_failed" }, { status: 500 });
  }
}
