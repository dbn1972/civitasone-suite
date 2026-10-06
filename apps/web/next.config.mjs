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
          // HIGH fix (geo-attendance check-in/out): this blanket policy
          // denied geolocation to every page, including this app's own
          // origin -- predating any in-app use of navigator.geolocation
          // (checked: nothing in apps/web called it before GeoCheckInCard,
          // the new self-service check-in/out UI this fix adds for the
          // existing geo-attendance backend). Without this, the browser
          // silently refuses the geolocation request on every page load
          // regardless of the calling code's own correctness ("Permissions
          // policy violation: Geolocation access has been blocked"),
          // making that whole feature non-functional for every user, not
          // just a test environment. Narrowed to this app's own origin only
          // (self) -- never opened to third-party/cross-origin content, and
          // camera/microphone stay fully denied (no feature in this app
          // uses either).
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
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
      // Legacy finance bookmarks -> HR modules. Done here (not as page-level
      // redirect() calls) because finance/layout.tsx role-gates every
      // /finance/* child BEFORE the page runs, so a non-finance employee would
      // see PermissionDenied instead of being redirected. Config redirects run
      // first and keep the query string (GAP-FINANCE-ADVANCES-01,
      // GAP-FINANCE-BENEFITS-01/02).
      { source: '/finance/advances', destination: '/hr/advances', permanent: true },
      { source: '/finance/benefits', destination: '/hr/benefits', permanent: true },
      // GAP-FINANCE-TRAVEL-01: finance/travel/page.tsx also redirect()s, but only
      // after finance/layout.tsx's role gate, so an employee/manager with an old
      // bookmark saw PermissionDenied. This config redirect runs before layouts.
      { source: '/finance/travel', destination: '/hr/travel', permanent: true },
      { source: '/stock', destination: '/inventory', permanent: true },
      { source: '/stock/list', destination: '/inventory/list', permanent: true },
      { source: '/stock/ledger', destination: '/inventory/reconcile', permanent: true },
      { source: '/stock/dashboard', destination: '/inventory', permanent: true },
      // Legacy finance bookmarks -> HR modules (GAP-FINANCE-EXPENSES-02,
      // GAP-FINANCE-LOANS-02). Config redirects run before finance/layout.tsx's
      // role gate and keep the query string; the page-level redirect() files
      // and their orphaned components were deleted.
      { source: '/finance/expenses', destination: '/hr/expenses', permanent: true },
      { source: '/finance/loans', destination: '/hr/loans', permanent: true },
      // GAP-BILLING-HOME-02 / GAP-BILLING-LIST-01: /billing/list was an orphan
      // duplicate of /billing/plans (same getBillingPlans loader, same
      // "Billing — Plans" title) that was never linked from the hub, sidebar or
      // navRouteManifest. The route folder was deleted; this permanent redirect
      // keeps any external bookmark to the old URL working by sending it to the
      // canonical plans list.
      { source: '/billing/list', destination: '/billing/plans', permanent: true },
      // GAP-ESTABLISHMENT-HOME-03 / GAP-ESTABLISHMENT-FILES-02: /establishment and
      // /establishment/files were permanent aliases implemented as page-level
      // runtime redirect() calls (307 temporary), which also made the segment
      // flash establishment/loading.tsx before resolving. Moved to config
      // redirects (permanent: true -> 308) that run before any page or loading
      // boundary, so bookmarks/search engines learn the canonical URL and there
      // is no skeleton flash. The redirect() page.tsx and loading.tsx files were
      // deleted; establishment/layout.tsx + not-found.tsx stay for unknown
      // children such as /establishment/foo (GAP-ESTABLISHMENT-HOME-02).
      { source: '/establishment', destination: '/estab', permanent: true },
      { source: '/establishment/files', destination: '/estab/list', permanent: true },
      { source: '/stock/:path*', destination: '/inventory/:path*', permanent: true },
    ];
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
