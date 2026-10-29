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
 *
 * `/api/v1/hrms/visiting-card/public` (#1776) — anonymous QR-scan vCard download keyed on an
 * unguessable share token. hrms-service marks the route config:{public:true}, rate-limits it and
 * resolves the single card through a token-scoped RLS policy; this entry only lets the request past
 * the gateway bearer pre-check. Narrow to the `public` sub-tree, NOT /api/v1/hrms/visiting-card
 * (the authenticated /me routes keep their edge check).
 *
 * `/api/v1/citizen/certificates/verify` (V4-G-01) — the QR printed on an issued certificate opens
 * GET .../verify/:token anonymously (a verifier scanning a paper certificate has no account), but
 * the gateway 401d it before it could reach citizen-service. Narrowed to the `verify` sub-tree
 * (`pathname === p || startsWith(p + "/")`), NOT /api/v1/citizen/certificates, so issuance,
 * approval, list and lifecycle routes still require a bearer token. The upstream route is marked
 * config:{public:true}, is keyed on an unguessable token (migration 0044 token-scoped SELECT
 * policy), returns non-PII attestation fields only and rate-limits per client IP.
 *
 * `/api/v1/telephony/webhooks` (UAT G2 #28) - carrier (Twilio/Exotel) inbound/status/recording callbacks.
 * A carrier holds no user JWT. telephony-service marks exactly these routes config:{public:true} and
 * authenticates EVERY one with the carrier credential (X-Twilio-Signature HMAC-SHA1 / X-Exotel-Token),
 * failing closed with 401 when the secret is unset or the credential is missing/invalid. Narrow to the
 * `webhooks` sub-tree, NOT /api/v1/telephony, so calls, queues, agents, DIDs, IVR, recordings and
 * broadcast routes keep their edge check.
 */
/** Payment-gateway callbacks: passed through with the RAW body (provider signatures cover the exact bytes). */
export const BILLING_WEBHOOK_PREFIX = "/api/v1/billing/webhooks";

/** Carrier callbacks: passed through RAW (Twilio signs the form params); the carrier credential is the auth. */
export const TELEPHONY_WEBHOOK_PREFIX = "/api/v1/telephony/webhooks";
export const PUBLIC_PREFIXES = [
  "/api/identity",
  "/api/v1/install",
  // V4-B-06: anonymous permit QR verification (exact paths, not the whole service prefix).
  "/api/v1/advertisement/permits/verify",
  "/api/v1/building/permits/verify",
  "/api/v1/careers",
  "/api/v1/crm/public",
  "/api/v1/court/public",
  "/api/v1/tenant/msme-onboard",
  "/api/v1/hrms/visiting-card/public",
  "/api/v1/citizen/certificates/verify",
  // V4-B-03: payment-gateway server-to-server callbacks (Razorpay/PayU/CCAvenue). No bearer token
  // exists on them; billing-service authenticates each by the provider signature / hash.
  BILLING_WEBHOOK_PREFIX,
  // UAT G2 #28: carrier webhooks; telephony-service verifies the Twilio signature / Exotel token.
  TELEPHONY_WEBHOOK_PREFIX,
];

/**
 * UAT FQ9 #16 — device-credential routes.
 *
 * A visitor-service hardware device (printer / scanner / kiosk) holds a device bearer token minted by
 * visitor-service (`device_<base64url>`), never a Keycloak JWT, so jwtEdgeVerify 401'd it
 * ("Invalid JWT structure") before visitor-service could authenticate it.
 *
 * This is NOT a public prefix and NOT a general bypass. It is an exact (method, path) allow-list of the
 * routes visitor-service ITSELF authenticates with its deviceAuth preHandler (hash lookup of the device
 * token, status / expiry / rotation-grace / rate-limit checks) AND marks config:{public:true} so its
 * user-JWT auth plugin does not run first. The gateway skips ONLY its JWT signature check, and only when
 * the presented bearer carries the device-token prefix; the bearer is still required, the tenant/actor
 * headers are still stripped (no verified identity at the edge), and every other route — and any
 * non-device bearer on this route — keeps full edge verification.
 *
 * Deliberately excluded:
 *   - /v1/visitor/scans/upload and /scans/:sessionId/result: deviceAuth-guarded but NOT
 *     config:{public:true}, so visitor-service's auth plugin rejects a device token before deviceAuth
 *     runs. Listing them here would forward requests the upstream cannot accept.
 *   - /v1/visitor/turnstiles/*: mTLS devices; a client certificate cannot traverse this proxy.
 *   - /v1/visitor/badges/jobs/*: deviceAuth-guarded but not public upstream (same as scans).
 */
export const DEVICE_TOKEN_PREFIX = "device_";

export const DEVICE_AUTH_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: "POST", path: "/api/v1/visitor/devices/heartbeat" },
];

/** Exact (method, canonical path) match — no prefix matching, no wildcards. */
export function isDeviceAuthRoute(method: string, pathname: string): boolean {
  const m = (method ?? "").toUpperCase();
  return DEVICE_AUTH_ROUTES.some((r) => r.method === m && r.path === pathname);
}

/** True when `authorization` is `Bearer device_...` (a visitor-service device token, not a JWT). */
export function isDeviceBearer(authorization: string | undefined): boolean {
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) return false;
  return authorization.slice(7).startsWith(DEVICE_TOKEN_PREFIX);
}
