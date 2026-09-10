import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { HttpError } from "@/lib/crm/http";
import { recheckRegister } from "@/lib/prospects/registerCheck";
import { ProspectError, getProspect, patchProspect, type ProspectPatch } from "@/lib/prospects/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET — the prospect as stored (the blocks re-load it after a patch). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const id = parseId((await params).id);
  const prospect = id ? getProspect(id) : null;
  if (!prospect) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, prospect });
}

const PATCH_KEYS = ["fit", "not_fit_reason", "locale", "website", "contact_email_override", "contact_phone_override", "forbids_override_reason", "not_this_business", "recollect"] as const;

/**
 * Patch fit / locale / website / validated overrides / forbids override
 * reason / not_this_business / recollect (contract §6). `{ recheck_register:
 * true }` runs the live register re-check first (502 register_check_failed
 * when the register is unreachable). Unknown keys are ignored.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const current = getProspect(id);
  if (!current) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  let registerCheck: Awaited<ReturnType<typeof recheckRegister>> | null = null;
  if (body.recheck_register === true) {
    try {
      registerCheck = await recheckRegister(current);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : "network";
      return NextResponse.json({ ok: false, error: "register_check_failed", code }, { status: 502 });
    }
  }

  const patch: ProspectPatch = {};
  for (const k of PATCH_KEYS) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  try {
    const prospect = patchProspect(id, patch);
    return NextResponse.json({ ok: true, prospect, registerCheck });
  } catch (e) {
    if (e instanceof ProspectError) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    console.error("prospect patch failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "patch_failed" }, { status: 500 });
  }
}
