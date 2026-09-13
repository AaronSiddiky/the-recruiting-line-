import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ~/code contains a stray package.json, so pin the root to this project
  turbopack: {
    root: __dirname,
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
