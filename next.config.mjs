/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,
  images: {
    // Served behind nginx with no image optimizer; keep assets as-is.
    unoptimized: true,
  },
  // Self-hosted Umami analytics runs on 127.0.0.1:3002 under BASE_PATH=/u.
  // Proxy it through this app so it's reachable at https://digitalm.eu/u
  // (the tracking script posts same-origin to /u/api/send).
  async rewrites() {
    return [
      { source: "/u", destination: "http://127.0.0.1:3002/u" },
      { source: "/u/:path*", destination: "http://127.0.0.1:3002/u/:path*" },
    ];
  },
};

export default nextConfig;
