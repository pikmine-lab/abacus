import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The core package ships raw TypeScript; Next compiles it with the app.
  transpilePackages: ['@abacus/core'],
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  // Never framed: a framed consent page lets another site overlay it and
  // trick the click that hands an AI client the account. Nothing here is meant
  // to be embedded, so the rule holds for every page.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
