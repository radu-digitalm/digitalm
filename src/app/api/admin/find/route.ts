import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { HttpError } from "@/lib/crm/http";
import { AreaQueryError } from "@/lib/discover/areaQuery";
import { DiscoverError, RunnerError, getSearch, parseCategory, parseSources, planSearch, resolveArea, sliceResult, startSearch, type AreaPick } from "@/lib/discover/index";
import { note } from "@/lib/discover/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Resolving (two Nominatim calls at 1.1 s spacing) + one Overpass count stay well under nginx's 60 s.
export const maxDuration = 55;

function intParam(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * GET ?id=N[&after=K&v=V] — the search as it stands (docs/finder-ux-spec.md
 * §4): rows from index K when the list version matches, else the whole list.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = Number.parseInt(req.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  const result = getSearch(id);
  if (!result) return NextResponse.json({ ok: false, error: "search_expired", message: note("expired").text }, { status: 404 });
  const sliced = sliceResult(result, intParam(req.nextUrl.searchParams.get("after")), intParam(req.nextUrl.searchParams.get("v")));
  return NextResponse.json({ ok: true, ...sliced });
}

function parsePick(v: unknown): AreaPick | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const osmType = o.osmType;
  const osmId = Number(o.osmId);
  if ((osmType !== "relation" && osmType !== "node" && osmType !== "way") || !Number.isInteger(osmId) || osmId <= 0) return null;
  return { osmType, osmId };
}

/**
 * { area, category, sources?, pick?, confirmCap? } → resolve the area, estimate,
 * gate large areas, start the background search (§4):
 *   202 started · 200 gate over_cap · 409 ambiguous / search_running ·
 *   404 area_not_found · 502 geocode_failed · 400 bad_area / bad_category / bad_request.
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
  const queryArea = typeof body.area === "string" ? body.area.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  const pick = parsePick(body.pick);
  if (!queryArea && !pick) return NextResponse.json({ ok: false, error: "bad_area" }, { status: 400 });
  if (body.pick !== undefined && !pick) return NextResponse.json({ ok: false, error: "bad_area" }, { status: 400 });
  const category = parseCategory(body.category);
  if (!category) return NextResponse.json({ ok: false, error: "bad_category" }, { status: 400 });
  const sources = parseSources(body.sources);
  const confirmCap = body.confirmCap === true;

  try {
    const { area, alternatives } = await resolveArea(queryArea, pick ?? undefined);
    const outcome = await planSearch(area, category, { confirmCap });
    if (outcome.gate === "over_cap") return NextResponse.json({ ok: true, gate: "over_cap", area, plan: outcome.plan });
    const { searchId } = startSearch({ queryArea: queryArea || area.label, area, category, sources, plan: outcome.plan });
    return NextResponse.json(
      {
        ok: true,
        searchId,
        area,
        plan: { expected: outcome.plan.expected, cap: outcome.plan.cap, units: outcome.plan.units.length, estimateMs: outcome.plan.estimateMs },
        ...(alternatives.length > 0 ? { alternatives } : {}),
      },
      { status: 202 },
    );
  } catch (e) {
    if (e instanceof DiscoverError) return NextResponse.json({ ok: false, error: e.code, message: e.message, ...(e.detail ?? {}) }, { status: e.status });
    if (e instanceof RunnerError) return NextResponse.json({ ok: false, error: e.code, ...(e.detail ?? {}) }, { status: e.status });
    if (e instanceof AreaQueryError) return NextResponse.json({ ok: false, error: "bad_area" }, { status: 400 });
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: "geocode_failed", message: "The place lookup did not answer. Try again in a minute." }, { status: 502 });
    console.error("find failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "search_failed" }, { status: 500 });
  }
}
