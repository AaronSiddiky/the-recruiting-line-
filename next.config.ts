import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package.json/lockfile above this directory would otherwise make
  // Turbopack infer the wrong workspace root.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // The marketing site and the dialer have separate root layouts, so there is
    // no single layout to compose a 404 from; app/global-not-found.tsx covers both.
    globalNotFound: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-*",
        search: "?w=2400&q=85&fit=crop",
      },
    ],
  },
  async headers() {
    return [
      {
        // Hero clips and poster never change in place; rename a file to bust it.
        source: "/hero/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
