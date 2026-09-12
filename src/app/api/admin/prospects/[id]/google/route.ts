import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { GOOGLE_OFF_ERROR, GoogleError, googlePlacesOn, googleUsage } from "@/lib/discover/google";
import { findCandidates, googleCheck, storeCheckResult, type CheckProspect } from "@/lib/discover/googleCheck";
import { applyManual } from "@/lib/discover/googleCheckRules";
import { placeIdOk } from "@/lib/discover/googleRequests";
import { GOOGLE_ONLY_AUDIT_PRIORITY, ProspectError, enqueueAudit, getProspect, updateGoogleColumns, type ProspectRecord } from "@/lib/prospects/store";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const CHECK_TIMEOUT_MS = 8_000;

function checkProspectOf(p: ProspectRecord): CheckProspect {
  return {
    id: p.id,
    name: p.name,
    tradeKey: p.tradeKey,
    country: p.country,
    city: p.city,
    postcode: p.postcode,
    lat: p.lat,
    lng: p.lng,
    googlePlaceId: p.googlePlaceId,
    googleListing: p.googleListing,
    googleMatch: p.googleMatch ?? null,
    googleCheckedAt: p.googleCheckedAt ?? null,
  };
}

/** The error shape of docs/finder-google-spec.md §4.5 for a Google failure. */
function googleFailure(code: string, pool?: string): NextResponse {
  if (code === "allowance") return NextResponse.json({ ok: false, error: "google_monthly_cap", pool: pool ?? null, usage: googleUsage() }, { status: 429 });
  if (code === "refused") return NextResponse.json({ ok: false, error: "google_refused" }, { status: 502 });
  if (code === "off" || code === "no_key") return NextResponse.json({ ok: false, error: GOOGLE_OFF_ERROR }, { status: 501 });
  return NextResponse.json({ ok: false, error: "google_unavailable" }, { status: 502 });
}

/** Steps 2–3 of §4.5 inline, always fresh: match when there is no place, then the derived signals; the result lands in the latest audit. */
async function runCheck(id: number): Promise<NextResponse> {
  const prospect = getProspect(id);
  if (!prospect) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const out = await googleCheck(checkProspectOf(prospect), { fresh: true, retry: false, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  if (out.error) return googleFailure(out.error, out.errorPool);
  if (out.decision !== "passthrough" && out.decision !== "skip_no_location") {
    const audited = storeCheckResult(id, out.google);
    if (audited === null) enqueueAudit(id, prospect.website ? {} : { priority: GOOGLE_ONLY_AUDIT_PRIORITY });
  }
  return NextResponse.json({ ok: true, prospect: getProspect(id), signals: out.signals, usage: googleUsage() });
}

/**
 * { action: "check" | "find" | "confirm" | "reject" | "clear", placeId? } —
 * docs/finder-google-spec.md §4.5. `check` re-runs the listing check now
 * (fresh, ≤ 8 s) and stores it in the latest audit; `find` returns the ≤ 5
 * manual-match candidates of one Text Search (transient); `confirm` sets the
 * place by hand then checks; `reject` marks the listing not found (the only
 * way to `not_found`); `clear` returns to unverified so the automatic match
 * may run again. 501 google_off while GOOGLE_PLACES=off; 429 google_monthly_cap
 * { pool }; 502 google_unavailable / google_refused.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  if (!googlePlacesOn()) return NextResponse.json({ ok: false, error: GOOGLE_OFF_ERROR }, { status: 501 });
  if (!rateLimit(`google-check:${clientIp(req)}`, 30, 10 * 60_000)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
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
    if (action === "check") return await runCheck(id);
    if (action === "find") {
      const candidates = await findCandidates(checkProspectOf(prospect), { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      return NextResponse.json({ ok: true, candidates, usage: googleUsage() });
    }
    if (action === "confirm") {
      if (!placeIdOk(body.placeId)) return NextResponse.json({ ok: false, error: "bad_place_id" }, { status: 400 });
      updateGoogleColumns(id, applyManual("confirm", { placeId: body.placeId, now: new Date() }).columns);
      return await runCheck(id);
    }
    if (action === "reject") {
      updateGoogleColumns(id, applyManual("reject", { now: new Date() }).columns);
      return NextResponse.json({ ok: true, prospect: getProspect(id), signals: null, usage: googleUsage() });
    }
    if (action === "clear") {
      updateGoogleColumns(id, applyManual("clear", { now: new Date() }).columns);
      return NextResponse.json({ ok: true, prospect: getProspect(id), signals: null, usage: googleUsage() });
    }
    return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
  } catch (e) {
    if (e instanceof GoogleError) return googleFailure(e.code, e.pool);
    if (e instanceof ProspectError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    console.error("google route failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "google_failed" }, { status: 500 });
  }
}
