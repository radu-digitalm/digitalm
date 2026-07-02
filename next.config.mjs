/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,
  images: {
    // Served behind nginx with no image optimizer; keep assets as-is.
    unoptimized: true,
  },
  // Self-hosted Umami analytics runs on 127.0.0.1:3002 under BASE_PATH=/anal1t1c5
  // (obscured path). Proxy it through this app so it's reachable at
  // https://digitalm.eu/anal1t1c5 (the tracking script posts same-origin to /anal1t1c5/api/send).
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
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
      {
        // Static assets are content-addressed or rarely change — cache hard.
        source: "/:dir(brand|badges|media)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
