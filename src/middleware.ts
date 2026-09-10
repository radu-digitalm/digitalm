import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale, isLocale } from "@/lib/i18n";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { verifySessionEdge } from "@/lib/crm/authEdge";

function resolveLocale(req: NextRequest): string {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (isLocale(cookie)) return cookie;

  const accept = (req.headers.get("accept-language") || "").toLowerCase();
  const langs = accept.split(",").map((part) => part.split(";")[0].trim());
  for (const lang of langs) {
    if (lang.startsWith("fr")) return "fr";
    if (lang.startsWith("en")) return "en";
  }
  return defaultLocale;
}

const isAdminPath = (p: string) => p === "/admin" || p.startsWith("/admin/");
const isLoginPath = (p: string) => p === "/admin/login";
const isToolsPath = (p: string) => isAdminPath(p) || p.startsWith("/r/") || p.startsWith("/o/");

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CRM tool routes live outside the locale tree (contract §4). The edge cookie
  // check below also covers RSC / soft-navigation requests, which skip shared
  // layouts — every (gated) page still calls requireAdmin() itself.
  if (isAdminPath(pathname) && !isLoginPath(pathname)) {
    const session = await verifySessionEdge(
      req.cookies.get("dm_admin")?.value,
      process.env.ADMIN_SESSION_SECRET ?? "",
      process.env.ADMIN_SESSION_VERSION || "1",
    );
    if (!session) {
      const login = req.nextUrl.clone();
      login.pathname = "/admin/login";
      login.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(login, 307);
    }
  }
  // Public token pages: per-IP limits so a leaked link cannot be brute-forced
  // or hammered. The report and opt-out routes also carry their own guards.
  if (pathname.startsWith("/r/") && !rateLimit(`r:${clientIp(req)}`, 60, 10 * 60_000)) {
    return new NextResponse("Too many requests", { status: 429 });
  }
  if (pathname.startsWith("/o/") && !rateLimit(`o:${clientIp(req)}`, 30, 10 * 60_000)) {
    return new NextResponse("Too many requests", { status: 429 });
  }
  if (isToolsPath(pathname)) return NextResponse.next();

  const hasLocale = locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );

  // Legacy WordPress permalinks (?page_id=N) are still in Google's crawl queue.
  // Left alone they resolve to /en?page_id=N — a duplicate of /en that only a
  // canonical tag disambiguates. Strip the parameter with a 301 so the old URL
  // collapses onto the clean one. Every other param is preserved: utm_* for
  // campaign attribution and the diagnostic's ?name/?email/?ref hand-off to
  // /book both depend on surviving this.
  if (req.nextUrl.searchParams.has("page_id")) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete("page_id");
    if (!hasLocale) {
      clean.pathname = `/${resolveLocale(req)}${pathname === "/" ? "" : pathname}`;
    }
    return NextResponse.redirect(clean, 301);
  }

  if (hasLocale) return;

  const locale = resolveLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals, API routes, the /anal1t1c5 Umami proxy, and any file with an extension.
  matcher: ["/((?!_next|api|anal1t1c5|anal1t1c5/|.*\\..*).*)"],
};
