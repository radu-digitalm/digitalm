import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { HttpError } from "@/lib/crm/http";
import { AreaQueryError } from "@/lib/discover/areaQuery";
import type { AreaHint } from "@/lib/discover/geocode";
import { DiscoverError, RunnerError, getSearch, googlePlacesOn, parseCategory, parseSources, placeIdOk, planSearch, resolveArea, resolveSuggestion, startSearch, type AreaPick } from "@/lib/discover/index";
import { note } from "@/lib/discover/notes";
import { clientIp, rateLimit } from "@/lib/rateLimit";

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
 * GET ?id=N[&after=K&v=V&pins=P] — the search as it stands (docs/finder-ux-spec.md
 * §4): rows from index K when the list version matches, else the whole list;
 * the Google pins (finder-google §4.8) on a full read or when `pins` is behind.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = Number.parseInt(req.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  const result = getSearch(id, { after: intParam(req.nextUrl.searchParams.get("after")), version: intParam(req.nextUrl.searchParams.get("v")), pins: intParam(req.nextUrl.searchParams.get("pins")) });
  if (!result) return NextResponse.json({ ok: false, error: "search_expired", message: note("expired").text }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}

function parsePick(v: unknown): AreaPick | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const osmType = o.osmType;
  const osmId = Number(o.osmId);
  if ((osmType !== "relation" && osmType !== "node" && osmType !== "way") || !Number.isInteger(osmId) || osmId <= 0) return null;
  return { osmType, osmId };
}

/** `suggestion: { placeId }` (finder-google §4.4) — the id only; any other key is ignored. */
function parseSuggestion(v: unknown): { placeId: string } | null {
  if (!v || typeof v !== "object") return null;
  const id = (v as Record<string, unknown>).placeId;
  return placeIdOk(id) ? { placeId: id } : null;
}

const SUGGESTION_UNRESOLVED = "Google could not resolve that place — type the area instead";

/**
 * { area, category, sources?, pick?, suggestion?, confirmCap?, fresh? } → resolve the area, estimate,
 * gate large areas, start the background search (§4):
 *   202 started (with `queryArea`) · 200 gate over_cap · 409 ambiguous / search_running ·
 *   404 area_not_found · 502 geocode_failed · 400 bad_area / bad_category / bad_request /
 *   bad_suggestion / suggestion_unresolved (finder-google §4.4: a Google place id closes
 *   an area suggestion through one Details Essentials call, then Nominatim with a hint).
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
  const suggestion = parseSuggestion(body.suggestion);
  if (body.suggestion !== undefined && body.suggestion !== null && !suggestion) return NextResponse.json({ ok: false, error: "bad_suggestion" }, { status: 400 });
  if (!queryArea && !pick && !suggestion) return NextResponse.json({ ok: false, error: "bad_area" }, { status: 400 });
  if (body.pick !== undefined && !pick) return NextResponse.json({ ok: false, error: "bad_area" }, { status: 400 });
  const category = parseCategory(body.category);
  if (!category) return NextResponse.json({ ok: false, error: "bad_category" }, { status: 400 });
  const sources = parseSources(body.sources);
  const confirmCap = body.confirmCap === true;
  const fresh = body.fresh === true; // "Run again": read every source anew instead of the 24 h cache

  // A suggestion pick: one Details Essentials call turns the id into a query and a hint for the geocoder; any Google
  // failure falls back to the typed text — and to 400 suggestion_unresolved when there is none (never resolveArea("")).
  let query = queryArea;
  let hint: AreaHint | undefined;
  if (suggestion && !pick) {
    if (!rateLimit(`google-suggest:${clientIp(req)}`, 60, 10 * 60_000)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    let resolved = false;
    if (googlePlacesOn()) {
      try {
        const r = await resolveSuggestion(suggestion, { signal: AbortSignal.timeout(4_500) });
        query = r.query;
        hint = { lat: r.lat, lng: r.lng, countryCode: r.countryCode, kind: r.kindHint };
        resolved = true;
      } catch {
        resolved = false;
      }
    }
    if (!resolved && !queryArea) return NextResponse.json({ ok: false, error: "suggestion_unresolved", message: SUGGESTION_UNRESOLVED }, { status: 400 });
  }

  try {
    const { area, alternatives } = await resolveArea(query, pick ?? undefined, hint);
    const outcome = await planSearch(area, category, { confirmCap });
    if (outcome.gate === "over_cap") return NextResponse.json({ ok: true, gate: "over_cap", area, plan: outcome.plan });
    // A bare department code ("09", posted by the gate's chips) is remembered by its name, so past searches read "Ariège".
    const storedQuery = !query || /^(0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/i.test(query) ? area.label : query;
    const { searchId } = startSearch({ queryArea: storedQuery, area, category, sources, plan: outcome.plan, fresh });
    return NextResponse.json(
      {
        ok: true,
        searchId,
        area,
        queryArea: storedQuery,
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
