import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // npm workspaces hoist dependencies to the monorepo root, so Turbopack's
  // root has to be the repo root for it to resolve them.
  turbopack: { root: path.join(__dirname, '../..') },
}

export default nextConfig
