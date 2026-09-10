import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { GOOGLE_OFF_ERROR, googleAdapter, googlePlacesOn, googleUsage } from "@/lib/discover/google";
import { ProspectError, getProspect, setGoogleListing } from "@/lib/prospects/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * { action: "find" | "confirm" | "clear", placeId?, listing?: "found" | "not_found" }
 * 501 { error: "google_off" } while GOOGLE_PLACES=off (contract §6). With the
 * adapter on: `find` asks the adapter (stub → no candidates), `confirm`
 * records the listing state and the place_id only, `clear` resets it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  if (!googlePlacesOn()) return NextResponse.json({ ok: false, error: GOOGLE_OFF_ERROR }, { status: 501 });
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  const prospect = getProspect(id);
  if (!prospect) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const action = body.action;
    if (action === "find") {
      const usage = googleUsage();
      if (usage.remaining <= 0) return NextResponse.json({ ok: false, error: "google_monthly_cap", ...usage }, { status: 429 });
      const candidates = await googleAdapter.search(
        { label: prospect.city ?? "", countryCode: prospect.country, center: { lat: prospect.lat ?? 0, lng: prospect.lng ?? 0 }, bbox: [0, 0, 0, 0], provider: "nominatim" },
        { key: prospect.tradeKey ?? "custom", label: { fr: "", en: "" }, osm: [], naf: [], sic: [] },
        { budgetMs: 10_000, signal: AbortSignal.timeout(10_000) },
      );
      return NextResponse.json({ ok: true, candidates, usage });
    }
    if (action === "confirm") {
      const listing = body.listing === "found" ? "found" : body.listing === "not_found" ? "not_found" : null;
      if (!listing) return NextResponse.json({ ok: false, error: "bad_listing" }, { status: 422 });
      const placeId = listing === "found" && typeof body.placeId === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(body.placeId) ? body.placeId : null;
      return NextResponse.json({ ok: true, prospect: setGoogleListing(id, listing, placeId) });
    }
    if (action === "clear") {
      return NextResponse.json({ ok: true, prospect: setGoogleListing(id, "unverified", null) });
    }
    return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
  } catch (e) {
    if (e instanceof ProspectError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    console.error("google route failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "google_failed" }, { status: 500 });
  }
}
