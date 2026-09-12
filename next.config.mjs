/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,
  images: {
    // Served behind nginx with no image optimizer; keep assets as-is.
    unoptimized: true,
  },
  // better-sqlite3 is a native addon — must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Self-hosted Umami analytics runs on 127.0.0.1:3002 under BASE_PATH=/anal1t1c5
  // (obscured path). Proxy it through this app so it's reachable at
  // https://digitalm.eu/anal1t1c5 (the tracking script posts same-origin to /anal1t1c5/api/send).
  async redirects() {
    // Legacy WordPress-era URLs still crawled by Google (GSC 404 report) —
    // 301 to the closest new page so any old backlink equity is recycled.
    return [
      { source: "/about-us", destination: "/en", permanent: true },
      { source: "/contact-us", destination: "/en/contact", permanent: true },
      { source: "/about", destination: "/en", permanent: true },
      { source: "/page/:n", destination: "/en", permanent: true },
    ];
  },
  async rewrites() {
    return [
      { source: "/anal1t1c5", destination: "http://127.0.0.1:3002/anal1t1c5" },
      { source: "/anal1t1c5/:path*", destination: "http://127.0.0.1:3002/anal1t1c5/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // CSP kept pragmatic for an SSG site with inline JSON-LD + Next hydration.
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
      // Admin pages with the Google map and the Places UI Kit (docs/finder-google-spec.md §5.1) —
      // only when the browser key is set at build time; the public site's CSP above is untouched
      // (for the same header key Next applies the last matching entry).
      ...(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
        ? [
            {
              source: "/admin/:path*",
              headers: [
                {
                  key: "Content-Security-Policy",
                  value:
                    "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com https://*.gstatic.com https://*.google.com blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://challenges.cloudflare.com https://maps.googleapis.com https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:; frame-src 'self' https://challenges.cloudflare.com https://*.google.com; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
                },
              ],
            },
          ]
        : []),
      {
        // Static assets are content-addressed or rarely change — cache hard.
        source: "/:dir(brand|badges|media)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      // CRM tool routes (admin, prospect reports, opt-out links, their APIs):
      // never indexed, never cached by a shared proxy.
      ...["/admin", "/admin/:path*", "/r/:path*", "/o/:path*", "/api/admin/:path*", "/api/o/:path*"].map((source) => ({
        source,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      })),
    ];
  },
};

export default nextConfig;
