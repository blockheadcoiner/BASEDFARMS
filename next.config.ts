import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/raydium/:path*',
        destination: 'https://transaction-v1.raydium.io/:path*',
      },
      {
        source: '/api/raydium-v3/:path*',
        destination: 'https://api-v3.raydium.io/:path*',
      },
      {
        source: '/api/jupiter/:path*',
        destination: 'https://quote-api.jup.ag/:path*',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
