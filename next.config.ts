import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ~/code contains a stray package.json, so pin the root to this project
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
