/**
 * A11Y-01 (WCAG 2.2.1): server-side silent token refresh against Keycloak's
 * token endpoint (client civitasone-web, refresh_token grant -- the same
 * endpoint/client the OIDC callback's code exchange uses).
 *
 * SINGLE-FLIGHT IS A CORRECTNESS REQUIREMENT, not an optimisation: the realm
 * rotates refresh tokens (revokeRefreshToken=true, refreshTokenMaxReuse=0),
 * and Keycloak treats a second use of an already-rotated refresh token as a
 * replay and revokes the whole session (verified against UAT Keycloak: after
 * a reuse attempt even the NEWEST refresh token is rejected). A page firing
 * several API calls at expiry, or two open tabs, would otherwise sign the
 * user out. So every concurrent refresh of the same refresh token shares one
 * Keycloak call, and the outcome is kept for a short grace window so requests
 * that were already in flight with the old cookie get the same new tokens
 * instead of replaying the old one.
 *
 * All refreshes go through the middleware (one runtime, one module instance),
 * so this map is the single place a given refresh token is ever redeemed.
 * Keys are SHA-256 digests -- refresh tokens are never held as map keys.
 */
import { refreshAccessToken } from "@civitasone/client-core";
import { getOidcConfig } from "./config";
import type { KeycloakTokenResponse } from "./sessionCookies";

export type RefreshOutcome =
  | { ok: true; tokens: KeycloakTokenResponse }
  /** invalid: Keycloak rejected the token (expired, revoked, replayed) -> sign out. unavailable: transient, retry later. */
  | { ok: false; reason: "invalid" | "unavailable" };

/** How long a settled outcome is reused for requests still carrying the old refresh token. */
export const REFRESH_GRACE_MS = 60_000;
const MAX_ENTRIES = 5_000;

interface Flight {
  promise: Promise<RefreshOutcome>;
  settledAt: number | null;
}

const flights = new Map<string, Flight>();

async function flightKey(refreshToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refreshToken));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function prune(now: number): void {
  for (const [key, flight] of flights) {
    if (flight.settledAt !== null && now - flight.settledAt > REFRESH_GRACE_MS) flights.delete(key);
  }
  // Hard cap (oldest first -- Map iterates in insertion order) so the cache can never grow without bound.
  for (const key of flights.keys()) {
    if (flights.size <= MAX_ENTRIES) break;
    flights.delete(key);
  }
}

function classify(err: unknown): "invalid" | "unavailable" {
  // refreshAccessToken() throws `TOKEN_REFRESH_FAILED: <status>`; network
  // errors and timeouts are TypeError/AbortError with no status.
  const status = /TOKEN_REFRESH_FAILED: (\d{3})/.exec(err instanceof Error ? err.message : "")?.[1];
  return status === "400" || status === "401" ? "invalid" : "unavailable";
}

async function redeem(refreshToken: string): Promise<RefreshOutcome> {
  try {
    const tokens = (await refreshAccessToken(getOidcConfig(), refreshToken)) as KeycloakTokenResponse;
    if (!tokens?.access_token || typeof tokens.expires_in !== "number") return { ok: false, reason: "unavailable" };
    return { ok: true, tokens };
  } catch (err) {
    return { ok: false, reason: classify(err) };
  }
}

/** Refresh once per refresh token, however many callers ask concurrently (see file header). */
export async function refreshTokensOnce(refreshToken: string, now: () => number = Date.now): Promise<RefreshOutcome> {
  const key = await flightKey(refreshToken);
  prune(now());
  const existing = flights.get(key);
  if (existing) return existing.promise;

  const flight: Flight = { promise: Promise.resolve({ ok: false, reason: "unavailable" }), settledAt: null };
  flight.promise = redeem(refreshToken).then((outcome) => {
    flight.settledAt = now();
    // A transient failure must not be cached: the next request should retry.
    if (!outcome.ok && outcome.reason === "unavailable") flights.delete(key);
    return outcome;
  });
  flights.set(key, flight);
  return flight.promise;
}

/**
 * Best-effort back-channel end of the Keycloak session for this refresh token
 * (Keycloak's logout endpoint accepts client_id + refresh_token for public
 * clients). Used on sign-out and on idle expiry so the SSO session cannot be
 * silently resumed. Never throws.
 */
export async function endKeycloakSession(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const oidc = getOidcConfig();
  try {
    await fetch(`${oidc.issuerUrl.replace(/\/$/, "")}/protocol/openid-connect/logout`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: oidc.clientId, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Best-effort: the app cookies are cleared regardless.
  }
}

/** Test seam only. */
export function __resetRefreshFlightsForTests(): void {
  flights.clear();
}
