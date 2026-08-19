import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The core package ships raw TypeScript; Next compiles it with the app.
  transpilePackages: ['@abacus/core'],
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
}

export default nextConfig
