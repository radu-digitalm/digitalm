import { NextRequest, NextResponse } from "next/server";
import { optoutByToken } from "@/lib/outreach/optout";
import { isOptoutToken, parseOptoutBody } from "@/lib/outreach/optoutToken";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, no session, no CSRF (contract §10): the 43-char token is the
// credential, found by unique-index lookup only. Limits live here because the
// middleware matcher skips /api: one-click bodies 5/min per token, everything
// else 10 per 10 min per IP. The page itself is limited by the middleware.

const tooMany = () => new NextResponse("Too many requests", { status: 429 });

function pageUrl(token: string, done?: string): string {
  return `${SITE_URL}/o/${token}${done ? `?done=${done}` : ""}`;
}

/** The List-Unsubscribe target opened by a human: straight to the confirmation page. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isOptoutToken(token)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(pageUrl(token), 303);
}

/**
 * Records the opt-out. Three bodies (contract §9): JSON `{confirm:true}` → JSON;
 * form `confirm=1` → 303 to the page with ?done=1 (or ?done=already);
 * exactly `List-Unsubscribe=One-Click` (RFC 8058) → 200. Idempotent; tokens
 * never expire; unknown token → 404.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isOptoutToken(token)) return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 404 });
  const raw = (await req.text()).slice(0, 4000);
  const body = parseOptoutBody(raw, req.headers.get("content-type"));
  if (body.kind === "invalid") return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  if (body.kind === "one_click") {
    if (!rateLimit(`o1:${token}`, 5, 60_000)) return tooMany();
    const r = optoutByToken(token, "one_click");
    if (r.status === "invalid") return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 404 });
    return NextResponse.json({ ok: true, status: r.status });
  }

  if (!rateLimit(`oapi:${clientIp(req)}`, 10, 10 * 60_000)) return tooMany();
  const r = optoutByToken(token, "link");
  if (body.kind === "form") {
    // An unknown token lands on the page, which renders the invalid-link text with a 404.
    if (r.status === "invalid") return NextResponse.redirect(pageUrl(token), 303);
    return NextResponse.redirect(pageUrl(token, r.status === "recorded" ? "1" : "already"), 303);
  }
  if (r.status === "invalid") return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 404 });
  return NextResponse.json({ ok: true, status: r.status });
}
