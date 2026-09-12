import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { placeIdOk } from "@/lib/discover/googleRequests";
import { ProspectError, addByUrl } from "@/lib/prospects/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Add by URL: { url, name?, country, googlePlaceId? } (country required, ISO2).
 * Source `manual`, domain_key, 30-day notice deadline, audit enqueued. A live
 * prospect with the same domain → 409 { error: "already_saved", reference,
 * placeAttached? }. `googlePlaceId` (finder-google §4.5, "Add by its website"
 * from a Google-only pin) stores the place as a manual match — attached to the
 * existing prospect when it has none; 400 bad_place_id on a malformed id.
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
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : null;
  const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
  if (!url) return NextResponse.json({ ok: false, error: "bad_url" }, { status: 422 });
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ ok: false, error: "bad_country" }, { status: 422 });
  const rawPlace = body.googlePlaceId;
  if (rawPlace !== undefined && rawPlace !== null && rawPlace !== "" && !placeIdOk(rawPlace)) return NextResponse.json({ ok: false, error: "bad_place_id" }, { status: 400 });
  const googlePlaceId = placeIdOk(rawPlace) ? rawPlace : null;
  try {
    const r = addByUrl({ url, name, country, googlePlaceId });
    if (r.existing) return NextResponse.json({ ok: false, error: "already_saved", id: r.id, reference: r.reference, ...(r.placeAttached !== undefined ? { placeAttached: r.placeAttached } : {}) }, { status: 409 });
    return NextResponse.json({ ok: true, id: r.id, reference: r.reference, auditQueued: r.auditQueued });
  } catch (e) {
    if (e instanceof ProspectError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    console.error("prospects add failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "add_failed" }, { status: 500 });
  }
}
