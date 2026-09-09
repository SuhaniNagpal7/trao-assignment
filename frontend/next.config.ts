import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  experimental: { proxyTimeout: 150000 },
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:8011'}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self)' }
    ] }];
  }
};
export default config;
