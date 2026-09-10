import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale, isLocale } from "@/lib/i18n";
import { OPPREF_COOKIE, OPPREF_MAX_AGE } from "@/lib/openaiAds";

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

  // ChatGPT Ads appends ?oppref=<click id> to the landing URL. Keep it in a
  // first-party cookie so the diagnostic/booking API routes can report the
  // conversion back to OpenAI later (lib/openaiAds.ts). The URL itself is left
  // untouched — no redirect, no analytics gap.
  const oppref = req.nextUrl.searchParams.get("oppref");
  const withOppref = (res: NextResponse) => {
    if (oppref && oppref.length <= 256) {
      res.cookies.set(OPPREF_COOKIE, oppref, {
        maxAge: OPPREF_MAX_AGE,
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      });
    }
    return res;
  };

  if (hasLocale) return oppref ? withOppref(NextResponse.next()) : undefined;

  const locale = resolveLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return withOppref(NextResponse.redirect(url));
}

export const config = {
  // Skip Next internals, API routes, the /anal1t1c5 Umami proxy, and any file with an extension.
  matcher: ["/((?!_next|api|anal1t1c5|anal1t1c5/|.*\\..*).*)"],
};
