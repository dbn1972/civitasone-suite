import createNextIntlPlugin from 'next-intl/plugin'
import bundleAnalyzer from '@next/bundle-analyzer'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
})

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
    // hr/org-chart vs hr/orgchart (HRMS role-based review, finding 1): these
    // were two independent implementations of the same page (orgchart, sprint
    // 6, is the original; org-chart, sprint 16, was an unintentional rebuild
    // that never replaced it in nav). org-chart is now canonical -- it alone
    // carries the UX-005 catalogued accessibility remediation (role=tree/
    // group/treeitem fix, PR #1428) and the GFR sanctioned-posts footnote,
    // which orgchart never received. Nav (hr/page.tsx) and the breadcrumb
    // label map (AutoBreadcrumb.tsx) now point at /hr/org-chart; this alias
    // keeps any existing bookmark/link to the old no-hyphen path working.
    // orgchart's zoom/search-highlight/expand-all controls (not present on
    // org-chart) were intentionally not ported in this fix -- flagged
    // separately rather than folded into a route-dedup change.
    //
    // Legacy /stock/* routes -> /inventory/* (requirement 1.7).
    // Specific paths must precede the /stock/:path* wildcard: Next.js
    // evaluates redirects in array order and the first match wins, so a
    // catch-all listed first would shadow the more specific redirects below.
    return [
      { source: '/hr/orgchart', destination: '/hr/org-chart', permanent: true },
      { source: '/stock', destination: '/inventory', permanent: true },
      { source: '/stock/list', destination: '/inventory/list', permanent: true },
      { source: '/stock/ledger', destination: '/inventory/reconcile', permanent: true },
      { source: '/stock/dashboard', destination: '/inventory', permanent: true },
      { source: '/stock/:path*', destination: '/inventory/:path*', permanent: true },
    ];
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
