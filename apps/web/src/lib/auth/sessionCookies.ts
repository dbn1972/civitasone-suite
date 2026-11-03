/**
 * A11Y-01 (WCAG 2.2.1): session-cookie helpers shared by the OIDC callback,
 * the middleware's silent refresh, and the session-status route.
 *
 * Runs in BOTH the Edge (middleware) and Node (route handler) runtimes, so it
 * only uses Buffer/JSON and no Node-only APIs.
 *
 * Every lifetime here is read from Keycloak's own token response / token
 * claims (expires_in, refresh_expires_in, exp, iat) -- nothing is hardcoded
 * except LEGACY_REFRESH_MAX_AGE_SEC, which is only the fallback when Keycloak
 * reports no refresh lifetime at all (an offline token).
 */
import type { TokenResponse } from "@civitasone/client-core";
import { COOKIE } from "./config";

/** Keycloak's token response also carries the refresh token's lifetime. */
export type KeycloakTokenResponse = TokenResponse & { refresh_expires_in?: number };

/** Previous fixed RT cookie lifetime; now only a fallback (see file header). */
export const LEGACY_REFRESH_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
}

export interface SessionCookieSpec {
  name: string;
  value: string;
  options: SessionCookieOptions;
}

/** Times the browser may see (never the tokens themselves). Epoch ms. */
export interface SessionTimes {
  authenticated: boolean;
  /** Access-token expiry. */
  accessExpiresAt: number | null;
  /** End of the Keycloak session as carried by the refresh token (idle or max, whichever is sooner). */
  sessionExpiresAt: number | null;
  /** Lifetime Keycloak granted the current refresh token (exp - iat): the SSO idle window. */
  idleTimeoutSec: number | null;
  /** True when the middleware can silently refresh this session. */
  refreshable: boolean;
}

/** Decode a JWT payload WITHOUT verifying it -- for lifetimes/display only, never authorisation. */
export function decodeJwtClaims(token: string | undefined | null): Record<string, unknown> | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numClaim(claims: Record<string, unknown> | null, name: string): number | null {
  const v = claims?.[name];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cookieOptions(maxAge: number): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAge)),
  };
}

/**
 * Whether a refresh token may be used for SILENT refresh: a normal Keycloak
 * refresh token, bound to the SSO session (so its idle/max lifetimes apply),
 * that has not yet expired. Offline tokens (typ "Offline", no exp) are
 * deliberately refused: they outlive the SSO session and sign-out, so
 * silently renewing with one would make a browser session unbounded.
 */
export function isSilentRefreshToken(rt: string | undefined | null, nowSec = Math.floor(Date.now() / 1000)): rt is string {
  const claims = decodeJwtClaims(rt);
  if (!claims) return false;
  if (claims.typ === "Offline") return false;
  const exp = numClaim(claims, "exp");
  return exp !== null && exp > nowSec;
}

/** RT cookie lifetime: Keycloak's refresh_expires_in, else the RT's exp claim, else the legacy fallback. */
export function refreshCookieMaxAge(tokens: KeycloakTokenResponse, nowSec = Math.floor(Date.now() / 1000)): number {
  if (typeof tokens.refresh_expires_in === "number" && tokens.refresh_expires_in > 0) return tokens.refresh_expires_in;
  const exp = numClaim(decodeJwtClaims(tokens.refresh_token), "exp");
  if (exp !== null && exp > nowSec) return exp - nowSec;
  return LEGACY_REFRESH_MAX_AGE_SEC;
}

/**
 * The cookies to write for a token response. Only the access and refresh
 * tokens are stored (each exactly once); the id_token is never persisted, so
 * the Set-Cookie headers stay at roughly 2 KB + 0.8 KB.
 */
export function sessionCookieSpecs(tokens: KeycloakTokenResponse, nowSec = Math.floor(Date.now() / 1000)): SessionCookieSpec[] {
  const specs: SessionCookieSpec[] = [
    { name: COOKIE.ACCESS, value: tokens.access_token, options: cookieOptions(tokens.expires_in) },
  ];
  if (tokens.refresh_token) {
    specs.push({ name: COOKIE.REFRESH, value: tokens.refresh_token, options: cookieOptions(refreshCookieMaxAge(tokens, nowSec)) });
  }
  return specs;
}

/**
 * Expiring both session cookies. Explicit path "/" (a bare delete would let
 * the browser default the path to the request's directory and miss them).
 */
export function clearedSessionCookieSpecs(): SessionCookieSpec[] {
  return [COOKIE.ACCESS, COOKIE.REFRESH].map((name) => ({ name, value: "", options: cookieOptions(0) }));
}

/** Browser-safe session timing derived from the two cookies (no token material). */
export function describeSessionTimes(at: string | undefined, rt: string | undefined, nowMs = Date.now()): SessionTimes {
  const nowSec = Math.floor(nowMs / 1000);
  const atClaims = decodeJwtClaims(at);
  const atExp = numClaim(atClaims, "exp");
  const refreshable = isSilentRefreshToken(rt, nowSec);
  const rtClaims = refreshable ? decodeJwtClaims(rt) : null;
  const rtExp = numClaim(rtClaims, "exp");
  const rtIat = numClaim(rtClaims, "iat");
  const authenticated = (!!at && (atExp === null || atExp > nowSec)) || refreshable;
  return {
    authenticated,
    accessExpiresAt: atExp !== null ? atExp * 1000 : null,
    sessionExpiresAt: rtExp !== null ? rtExp * 1000 : null,
    idleTimeoutSec: rtExp !== null && rtIat !== null && rtExp > rtIat ? rtExp - rtIat : null,
    refreshable,
  };
}
