/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,
  images: {
    // Served behind nginx with no image optimizer; keep assets as-is.
    unoptimized: true,
  },
};

export default nextConfig;
