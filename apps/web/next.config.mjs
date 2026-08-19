import createNextIntlPlugin from 'next-intl/plugin'
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Avoid @vercel/nft RangeError (BigInt / 0) on Next 14.2.35; pm2 uses next start with full node_modules.
  outputFileTracing: false,
  env: {
    NEXT_PUBLIC_PRODUCT_NAME: "CivitasOne Suite",
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Content-Security-Policy is now set dynamically in middleware.ts
          // with a per-request nonce (H2 fix — removes unsafe-inline/unsafe-eval).
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  async redirects() {
    // Legacy /stock/* routes -> /inventory/* (requirement 1.7).
    // Specific paths must precede the /stock/:path* wildcard: Next.js
    // evaluates redirects in array order and the first match wins, so a
    // catch-all listed first would shadow the more specific redirects below.
    return [
      { source: '/stock', destination: '/inventory', permanent: true },
      { source: '/stock/list', destination: '/inventory/list', permanent: true },
      { source: '/stock/ledger', destination: '/inventory/reconcile', permanent: true },
      { source: '/stock/dashboard', destination: '/inventory', permanent: true },
      { source: '/stock/:path*', destination: '/inventory/:path*', permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
