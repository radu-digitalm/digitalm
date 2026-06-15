import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale, isLocale } from "@/lib/i18n";

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const hasLocale = locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );
  if (hasLocale) return;

  const locale = resolveLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals, API routes, and any file with an extension.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
