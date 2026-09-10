import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // There is an unrelated package-lock.json above this directory; without this
  // Turbopack walks up and infers the wrong workspace root.
  turbopack: { root: path.resolve(__dirname) },
}

export default nextConfig
