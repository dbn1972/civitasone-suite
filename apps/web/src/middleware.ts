import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";
import { defaultLoginPath, isDevLoginEnabled } from "@/lib/auth/env";

// SEC-029: /api/metrics is public HERE (no session cookie) because a
// Prometheus scrape carries no browser session to check -- access is instead
// gated inside the route itself via METRICS_TOKEN (fail-closed; see
// src/app/api/metrics/route.ts), the same "gate at the handler, not the
// session layer" shape the backend services use for their own /metrics.
const PUBLIC = ["/auth", "/api/auth", "/api/careers", "/careers", "/_next", "/favicon.ico", "/sw.js", "/api/metrics"];

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

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${ALLOW_UNSAFE_EVAL_DEV ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self'${KEYCLOAK_ORIGIN ? ` ${KEYCLOAK_ORIGIN}` : ''}`,
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/auth/dev") && !isDevLoginEnabled()) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) return buildNextResponse(req);

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
