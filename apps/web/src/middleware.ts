import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";
import { defaultLoginPath, isDevLoginEnabled } from "@/lib/auth/env";
import { tileImgSource } from "@/lib/mapTiles";

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
const PUBLIC = ["/auth", "/api/auth", "/api/careers", "/careers", "/verify", "/_next", "/favicon.ico", "/sw.js", "/vendor/leaflet/", "/maps/civitas-map.js", "/api/metrics", "/sandbox", "/api/sandbox", "/contact", "/api/contact", "/.well-known", "/logout", "/offline"];

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/auth/dev") && !isDevLoginEnabled()) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (isPublicPath(pathname)) return buildNextResponse(req);

  const token = req.cookies.get(COOKIE.ACCESS)?.value;
  if (!token || isTokenExpired(token)) {
    const login = new URL(defaultLoginPath(), req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return buildNextResponse(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
