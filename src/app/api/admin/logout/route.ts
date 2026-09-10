import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, guardAdminPost, isResponse, sessionCookieOptions } from "@/lib/crm/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clears the session cookie. Session + CSRF required (a cross-site form must
// not be able to log the admin out either).
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...sessionCookieOptions(0), expires: new Date(0) });
  return res;
}
