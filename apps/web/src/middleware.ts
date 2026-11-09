import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";
import { defaultLoginPath, isDevLoginEnabled } from "@/lib/auth/env";
import { tileImgSource } from "@/lib/mapTiles";
import { clearedSessionCookieSpecs, decodeJwtClaims, isSilentRefreshToken, sessionCookieSpecs } from "@/lib/auth/sessionCookies";
import { forgetRefreshToken, refreshTokensOnce } from "@/lib/auth/tokenRefresh";

// SEC-029: /api/metrics is public HERE (no session cookie) because a
// Prometheus scrape carries no browser session to check -- access is instead
// gated inside the route itself via METRICS_TOKEN (fail-closed; see
// src/app/api/metrics/route.ts), the same "gate at the handler, not the
// session layer" shape the backend services use for their own /metrics.
// W0: the marketing /contact page, its /api/contact submit route and
// /.well-known/security.txt (RFC 9116) are meant for anonymous visitors and
// researchers; the matcher below runs on every non-static path, so anything
// absent from this list is redirected to login.
//
// Marketing site (app/(marketing)): every page under that route group is for
// anonymous visitors, so each is listed here and middleware.test.ts walks the
// route group to fail if a new one is added without being made public. "/" can
// only be matched exactly (a "/" prefix would make everything public), and
// "/pricing" and "/docs" are matched on a path-segment boundary so an unrelated
// route that merely starts with the same letters stays private.
const PUBLIC_EXACT = ["/"];
// /offline: the service-worker fallback page; user-agnostic (locale only) and must be
// fetchable anonymously so the SW can (re)precache it after logout (V4-A-01, V4-A-09).
const PUBLIC_SEGMENT = ["/pricing", "/docs"];
const PUBLIC = ["/auth", "/api/auth", "/api/careers", "/careers", "/verify", "/_next", "/favicon.ico", "/sw.js", "/vendor/leaflet/", "/maps/civitas-map.js", "/api/metrics", "/sandbox", "/api/sandbox", "/contact", "/api/contact", "/.well-known", "/logout", "/offline",
  // UAT-P2-D3 (A11Y-19, GIGW 3.0): compliance pages must be readable without signing in.
  "/accessibility-statement", "/screen-reader-access", "/website-policies",
  // UAT post-b14 (GIGW 3.0): the remaining GIGW pages and their common aliases.
  "/accessibility", "/policies", "/sitemap", "/site-map", "/about", "/contact-us", "/help-desk", "/feedback",
  "/privacy", "/privacy-policy", "/terms", "/terms-and-conditions", "/hyperlink-policy", "/copyright-policy", "/disclaimer",
  // UAT gigw-content (GIGW 3.0): the content policies listed on /website-policies.
  "/content-contribution-policy", "/content-archival-policy", "/content-review-policy"];

// M2: decode JWT payload and check exp claim — does not verify signature
// (signature is checked by the gateway on every proxied request).
// Returns true if the token is structurally expired; false on any parse error
// so valid-but-unparseable tokens still reach the backend and get a 401 there.
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString(),
    );
    return typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// A11Y-01 (WCAG 2.2.1): refresh a little BEFORE the access token expires so a
// request never reaches the gateway with a token that dies in flight.
const REFRESH_SKEW_SEC = 60;
// POST here forces a refresh (the session-expiry warning's "Stay signed in" and
// the active-user timer). Handled by this middleware so that EVERY refresh of a
// given refresh token goes through the one single-flight cache in
// lib/auth/tokenRefresh.ts -- Keycloak revokes the session on refresh-token reuse.
const REFRESH_PATH = "/api/auth/refresh";
// Sign-out routes. The refresh cache lives in THIS module instance (the
// middleware runtime), not in the route handlers' module graph, so it is
// cleared here, before the handler runs, for every sign-out request.
const SIGN_OUT_PATHS = new Set(["/logout", "/api/auth/logout"]);

// W7 (C-SESS-COOKIE-002): a cookie that is not even a decodable JWT ("not.a.jwt", truncated,
// junk) is not a session. isTokenExpired/isTokenExpiringSoon deliberately return false on parse
// errors, so without this check such a cookie sailed through as "valid" and the dashboard shell
// rendered with 401s from the gateway. Structure only; the signature stays the gateway's job.
function isUndecodableToken(token: string): boolean {
  return decodeJwtClaims(token) === null;
}

function isTokenExpiringSoon(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp - REFRESH_SKEW_SEC <= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// H2: resolve Keycloak origin once at module load for use in connect-src.
// Uses NEXT_PUBLIC_KEYCLOAK_ISSUER_URL (set in .env and ecosystem.config.js).
const KEYCLOAK_ORIGIN = (() => {
  try {
    const u = process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER_URL ?? '';
    return u ? new URL(u).origin : '';
  } catch {
    return '';
  }
})();

// V4-A-02: pages PUT files straight to object storage via a presigned URL (CRM
// documents, onboarding, reimbursements, tax proofs, citizen documents). That is
// a cross-origin fetch, so connect-src must name the storage origin. Resolved
// once at module load, origin only (no path/query), http(s) only, from
// NEXT_PUBLIC_STORAGE_ORIGIN (browser-facing; preferred), else AWS_ENDPOINT_URL
// (LocalStack / S3-compatible), else the virtual-hosted AWS S3 origin derived from
// AWS_S3_BUCKET + AWS_DEFAULT_REGION. Never a wildcard.
const STORAGE_ORIGIN = (() => {
  try {
    let raw = process.env.NEXT_PUBLIC_STORAGE_ORIGIN || process.env.AWS_ENDPOINT_URL || '';
    if (!raw && process.env.AWS_S3_BUCKET) {
      raw = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_DEFAULT_REGION || 'ap-south-1'}.amazonaws.com`;
    }
    if (!raw) return '';
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch {
    return '';
  }
})();

// H2-DEV (accounting-high-findings): `next dev`'s webpack HMR / React Refresh
// runtime calls eval() to apply module updates; the strict H2 CSP below (no
// 'unsafe-eval') blocks it, and the resulting CSP violation surfaces only in
// devtools, not as a visible app error -- from the outside it looks like a
// plain, silent page reload. Live-confirmed: submitting the journal-entry /
// voucher form under `next dev` triggered exactly that silent reload with no
// request ever leaving the browser. Confirmed dev-server-only: a production
// build (`next build && next start`) needs no eval() at all and is
// unaffected -- this matches PR #1567's verification notes, which had to
// stand up a production build of this app for the same reason. Gated with
// the identical ALLOW-list shape as ecosystem.config.js's IS_PROD and
// packages/auth/src/index.ts's isProduction() (SEC-017): only an explicit
// "development"/"test" NODE_ENV relaxes script-src; unset, staging, uat, or
// a typo all keep the strict no-eval production policy.
const CSP_DEV_ALLOWED_ENVS = new Set(["development", "test"]);
const ALLOW_UNSAFE_EVAL_DEV = CSP_DEV_ALLOWED_ENVS.has(process.env.NODE_ENV ?? "");

// H2: build a NextResponse.next() with per-request nonce and dynamic CSP.
// Removes 'unsafe-inline' from script-src, and drops 'unsafe-eval' entirely
// outside of local dev (see H2-DEV above for the one exception).
// The nonce is threaded on both request headers (readable by server components
// via headers()) and response headers (usable by any client-side tooling).
function buildNextResponse(req: NextRequest): NextResponse {
  // Web Crypto API is available in both Edge and Node.js runtimes.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Buffer.from(nonceBytes).toString('base64');

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  // Route-scoped layout gates (tenant/_roles.ts adminAreaRoles) read this. Always overwritten
  // here so a client-sent x-pathname can never widen a gate.
  requestHeaders.set('x-pathname', req.nextUrl.pathname);

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${ALLOW_UNSAFE_EVAL_DEV ? " 'unsafe-eval'" : ""}`,
    // GAP2-SHELL-CSP-01 (review round 1): style-src / style-src-elem keep
    // unsafe-inline. ~28 components render inline <style> ELEMENTS (loading
    // shimmer keyframes, HR dashboard panels, print rules) that cannot carry
    // the request nonce, so dropping it silently loses their styling in the
    // browser. Inline style ATTRIBUTES are pinned explicitly via style-src-attr.
    // Scripts remain strict (nonce-only). Tightening <style> needs a nonce
    // threaded through every such component first.
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    // Map base-map tiles (MAP_TILE_URL, default OpenStreetMap) -- the map iframe is a
    // srcdoc document and inherits this policy.
    `img-src 'self' data: blob: ${tileImgSource()}`,
    `connect-src 'self'${KEYCLOAK_ORIGIN ? ` ${KEYCLOAK_ORIGIN}` : ''}${STORAGE_ORIGIN ? ` ${STORAGE_ORIGIN}` : ''}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('x-nonce', nonce);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_SEGMENT.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    // V4-A-04: boundary match (p or p + "/"), never a bare prefix, so /contacts,
    // /authz or /verifyx stay private. Entries ending in "/" are directory prefixes.
    PUBLIC.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))
  );
}

export function middleware(req: NextRequest): NextResponse | Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/auth/dev") && !isDevLoginEnabled()) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (pathname === REFRESH_PATH && req.method === "POST") return refreshSession(req, true);
  if (SIGN_OUT_PATHS.has(pathname)) return forgetThenContinue(req);

  if (isPublicPath(pathname)) return buildNextResponse(req);

  const token = req.cookies.get(COOKIE.ACCESS)?.value;
  if (token && !isUndecodableToken(token) && !isTokenExpiringSoon(token)) return buildNextResponse(req);

  // A11Y-01: expired / about to expire (or the access cookie already aged out)
  // but the SSO session is still alive -> renew silently instead of dumping the
  // user (and their unsaved form) on the login page.
  if (isSilentRefreshToken(req.cookies.get(COOKIE.REFRESH)?.value)) return refreshSession(req, false);

  if (!token) return loginRedirect(req);
  // A bad cookie is cleared so the browser does not keep replaying it.
  if (isUndecodableToken(token)) return loginRedirect(req, true);
  if (isTokenExpired(token)) return loginRedirect(req);
  return buildNextResponse(req);
}

// A rotated (pre-rotation) refresh token must not be redeemable from the
// grace cache after sign-out.
async function forgetThenContinue(req: NextRequest): Promise<NextResponse> {
  await forgetRefreshToken(req.cookies.get(COOKIE.REFRESH)?.value);
  return buildNextResponse(req);
}

/**
 * A browser navigation (address bar, plain link such as a file download, form post) cannot render a
 * JSON body, so it keeps the redirect to the sign-in page even under /api/. fetch()/XHR callers send
 * Sec-Fetch-Mode: cors|same-origin (or an Accept that does not prefer HTML) and get the JSON 401.
 */
function isBrowserNavigation(req: NextRequest): boolean {
  const mode = req.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (req.headers.get("accept") ?? "").includes("text/html");
}

function loginRedirect(req: NextRequest, clearCookies = false): NextResponse {
  const res = loginRedirectBase(req);
  if (clearCookies) for (const c of clearedSessionCookieSpecs()) res.cookies.set(c.name, c.value, c.options);
  return res;
}

function loginRedirectBase(req: NextRequest): NextResponse {
  // UAT T-EDGE TE-10 / TE-14: an API call with no live session used to get a 307 to the
  // sign-in page, which fetch() followed (a POST then ended in 405), so the form said "a
  // problem on our side". API calls now get a JSON 401 SESSION_EXPIRED the page can explain
  // ("Your session has expired. Sign in again ..."), with the typed entries kept.
  if (req.nextUrl.pathname.startsWith("/api/") && !isBrowserNavigation(req)) {
    return NextResponse.json({ code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }, { status: 401 });
  }
  const login = new URL(defaultLoginPath(), req.url);
  login.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

// Keycloak rejected the refresh token (expired, revoked, or replayed): end the
// app session cleanly. Pages go to login with the "session expired" message and
// a return URL; API calls get a JSON 401 (a redirect would hand fetch() the
// login page's HTML).
function sessionExpiredResponse(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  let res: NextResponse;
  if (pathname.startsWith("/api/") && !isBrowserNavigation(req)) {
    res = NextResponse.json({ code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }, { status: 401 });
  } else {
    const login = new URL(defaultLoginPath(), req.url);
    login.searchParams.set("error", "session_expired");
    login.searchParams.set("next", `${pathname}${search}`);
    res = NextResponse.redirect(login);
  }
  for (const c of clearedSessionCookieSpecs()) res.cookies.set(c.name, c.value, c.options);
  return res;
}

async function refreshSession(req: NextRequest, forced: boolean): Promise<NextResponse> {
  const token = req.cookies.get(COOKIE.ACCESS)?.value;
  const tokenStillValid = !!token && !isTokenExpired(token);
  const rt = req.cookies.get(COOKIE.REFRESH)?.value;

  if (!isSilentRefreshToken(rt)) {
    // Only reachable for the forced endpoint (the implicit path checks first).
    return tokenStillValid
      ? NextResponse.json({ code: "NOT_REFRESHABLE" }, { status: 409 })
      : NextResponse.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  }

  const outcome = await refreshTokensOnce(rt);
  if (outcome.ok) {
    const specs = sessionCookieSpecs(outcome.tokens);
    // Hand the NEW tokens to this same request's downstream handler (layout,
    // API proxy), then persist them in the browser.
    for (const c of specs) req.cookies.set(c.name, c.value);
    const res = buildNextResponse(req);
    for (const c of specs) res.cookies.set(c.name, c.value, c.options);
    return res;
  }
  if (outcome.reason === "invalid") return sessionExpiredResponse(req);

  // Keycloak unreachable: never sign the user out for a transient fault.
  if (forced) return NextResponse.json({ code: "REFRESH_UNAVAILABLE" }, { status: 503 });
  if (tokenStillValid) return buildNextResponse(req);
  // Expired and cannot be renewed right now: an API call gets the same JSON
  // 401 as a rejected token (never the login page's HTML). The cookies are
  // deliberately KEPT -- the refresh token is still valid, so the next request
  // after the outage renews the session instead of forcing a new sign-in.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }, { status: 401 });
  }
  return loginRedirect(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
