/**
 * Routes that do NOT require a bearer token at the gateway.
 *
 * SINGLE SOURCE OF TRUTH: this used to be two hand-copied literals, one in app.ts
 * (the bearer-token pre-check in proxyHandler) and one in jwt-edge.ts (edge signature
 * verification), each carrying a comment saying the other "must stay in sync" — which
 * is exactly the kind of thing that drifts unless something other than a comment
 * enforces it. A path public in one list but not the other gets 401'd by whichever
 * layer doesn't know about it; that already happened once (MSME self-signup) and
 * inspired this file. Both app.ts and jwt-edge.ts import this array instead of
 * declaring their own, so the two checks cannot disagree.
 *
 * SEC-3: sync/devices were REMOVED from this list — they carry tenant data and must
 * be authenticated at the edge. Only auth-bootstrap (identity login/refresh), the
 * first-run installer, and the narrow anonymous sub-trees below remain public.
 *
 * `/api/v1/crm/public` is LM-002 public lead capture: a prospect filling in a web form
 * has no token by definition. Kept as narrow as the requirement allows — it is the
 * `public` sub-tree of the CRM prefix, NOT `/api/v1/crm`, so no authenticated CRM route
 * loses its edge check. The upstream still resolves the tenant from a 64-hex form key,
 * rate-limits per IP and per tenant, and enforces consent; see
 * crm-service/src/modules/leads/public-routes.ts for the threat model.
 *
 * `/api/v1/court/public` is court-service's public citizen case-status lookup
 * (OTP/captcha/open per court config) plus the public court-establishment directory —
 * see court-service/src/modules/public-lookup/routes.ts for the threat model. Same
 * anonymous-route mechanism as /api/v1/crm/public above: the route is marked
 * config:{public:true} service-side, and this list is what lets an anonymous request
 * past the gateway's OWN bearer-token pre-check so it can even reach that service-side
 * check. Narrow to the /public sub-tree, NOT the whole /api/v1/court prefix, so no
 * authenticated court route loses its edge check.
 *
 * `/api/v1/tenant/msme-onboard` — MSME self-signup (deep-verification, 2026-08-27):
 * tenant-service's own route is marked config:{public:true} and does not read req.ctx,
 * but the gateway's own bearer-token pre-check runs BEFORE any request is proxied
 * downstream, so a real anonymous caller was still 401'd here even after the
 * tenant-service-side fix. An exact path, not the whole /api/v1/tenant prefix, to
 * avoid exposing any other tenant-service route (create/suspend/etc, all of which
 * still require a real role) to unauthenticated traffic at the gateway.
 */
export const PUBLIC_PREFIXES = [
  "/api/identity",
  "/api/v1/install",
  "/api/v1/careers",
  "/api/v1/crm/public",
  "/api/v1/court/public",
  "/api/v1/tenant/msme-onboard",
];
