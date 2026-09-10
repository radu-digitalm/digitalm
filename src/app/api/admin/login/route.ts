import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";
import {
  ADMIN_COOKIE,
  passwordHashConfigured,
  safeAdminNext,
  sessionCookie,
  sessionCookieOptions,
  sessionSecretOk,
  verifyPassword,
} from "@/lib/crm/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oneLine = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared-password login (contract §10): 5 attempts / 10 min per IP and 30 / 10
// min overall, honeypot, shared Turnstile check, scrypt verify, 500 ms pause on
// failure, cookie only on success. Nothing about the password is ever logged.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipOk = rateLimit(`admin-login:${ip}`, 5, 10 * 60_000);
  const allOk = rateLimit("admin-login:*", 30, 10 * 60_000);
  if (!ipOk || !allOk) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  // Honeypot: real users never fill this. Answer like a success, set nothing.
  if (oneLine(body.website)) {
    return NextResponse.json({ ok: true, redirect: "/admin" });
  }

  if (!passwordHashConfigured()) {
    return NextResponse.json({ ok: false, error: "login_disabled" }, { status: 503 });
  }
  if (!sessionSecretOk()) {
    console.error("admin login: ADMIN_SESSION_SECRET missing or shorter than 32 chars");
    return NextResponse.json({ ok: false, error: "server_config" }, { status: 500 });
  }

  // Turnstile: reject bad tokens, proceed (logged) on Cloudflare outage,
  // skipped when the secret is unset (local dev).
  const ts = await verifyTurnstile(oneLine(body.turnstile), ip);
  if (ts === "bad") {
    return NextResponse.json({ ok: false, error: "verification" }, { status: 403 });
  }
  if (ts === "outage") console.warn("admin login: Turnstile outage — proceeding on password alone");

  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyPassword(password)) {
    await sleep(500);
    console.warn("admin login: wrong password");
    return NextResponse.json({ ok: false, error: "password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, redirect: safeAdminNext(body.next) });
  res.cookies.set(ADMIN_COOKIE, sessionCookie("password", "admin"), sessionCookieOptions());
  console.log("admin login: success");
  return res;
}
