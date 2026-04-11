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
    ];
  },
};

export default nextConfig;
