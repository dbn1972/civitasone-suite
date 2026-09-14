import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@civitasone/client-core";
import { decodeUnverifiedClaims } from "@civitasone/auth";
import { captureError } from "@civitasone/observability";
import { getOidcConfig, COOKIE } from "@/lib/auth/config";

const SECURE = process.env.NODE_ENV === "production";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://civitasone.65-2-205-201.nip.io";
const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

// A failed or invalid callback must never leave the browser holding cookies
// that would poison the next attempt: this attempt's PKCE verifier/state,
// and any stale ACCESS/REFRESH left over from an earlier session.
function clearAuthCookies(jar: ReturnType<typeof cookies>) {
  jar.delete(COOKIE.PKCE_VERIFIER);
  jar.delete(COOKIE.OAUTH_STATE);
  jar.delete(COOKIE.ACCESS);
  jar.delete(COOKIE.REFRESH);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = cookies();
  const savedState = jar.get(COOKIE.OAUTH_STATE)?.value;
  const verifier = jar.get(COOKIE.PKCE_VERIFIER)?.value;

  if (!code || !state || !verifier || state !== savedState) {
    clearAuthCookies(jar);
    return NextResponse.redirect(new URL("/auth/login?error=invalid_callback", APP_URL));
  }

  try {
    const tokens = await exchangeAuthorizationCode(getOidcConfig(), code, verifier);
    jar.set(COOKIE.ACCESS, tokens.access_token, { httpOnly: true, secure: SECURE, sameSite: "strict", path: "/", maxAge: tokens.expires_in });
    if (tokens.refresh_token) {
      jar.set(COOKIE.REFRESH, tokens.refresh_token, { httpOnly: true, secure: SECURE, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 30 });
    }
    jar.delete(COOKIE.PKCE_VERIFIER);
    jar.delete(COOKIE.OAUTH_STATE);

    // SEC-015: record this login as a live, revocable session, keyed by the
    // token's own `sid` -- without this, SEC-006's admin-revoke denylist has
    // no real session to correlate against. Best-effort and awaited-but-
    // swallowed on failure: this is bookkeeping for admin session revocation,
    // not authentication itself, and a hiccup reaching identity-service (or
    // the gateway) must not lock a user out of an otherwise-successful login
    // -- the same fail-open-for-availability reasoning SEC-006's own denylist
    // check uses on the READ side (plugin.ts / denylist.ts), applied
    // symmetrically here on the WRITE side. SEC-027: a failure here is not
    // silent -- createBackendSession() reports it via captureError() (a
    // metric plus a structured log line, this codebase's fleet-wide
    // convention for exactly this "silent but important" failure class; see
    // e.g. services/identity-service/src/shared/keycloak.ts), so it stays
    // queryable/alertable instead of only a line in raw server logs.
    await createBackendSession(tokens.access_token, req).catch(() => {
      // Already reported inside createBackendSession() via captureError().
      // This catch only stops the failure from surfacing as an unhandled
      // rejection -- the fail-open contract above still applies.
    });

    return NextResponse.redirect(new URL("/dashboard", APP_URL));
  } catch (err) {
    // Server-side only (Route Handler); apps/web has no shared logger package,
    // and an auth failure here must stay observable in server logs.
    // eslint-disable-next-line no-console -- auth failure diagnostics, same rationale as RouteError.tsx
    console.error("[auth/callback] token exchange failed", err);
    clearAuthCookies(jar);
    return NextResponse.redirect(new URL("/auth/login?error=token_exchange_failed", APP_URL));
  }
}

// SEC-015: call the existing (previously never-invoked) POST /identity/sessions
// as the just-authenticated user themselves -- self-service, no elevated
// internal-service credentials needed (routes.ts already permits
// ctx.actorId === body.userId without SESSION_ADMIN). identity-service
// independently re-verifies this same bearer token (authPlugin) and derives
// the row's id from ITS OWN verified sid claim, not from anything in this
// request body -- the decode below is only used to fill tenantId/userId in
// the JSON body the endpoint requires; it is not the security boundary.
async function createBackendSession(accessToken: string, req: Request): Promise<void> {
  const claims = decodeUnverifiedClaims(accessToken);
  const userId = claims?.sub;
  const tenantId = claims?.tid ?? claims?.tenantId;
  try {
    if (!userId || !tenantId) {
      throw new Error("access token missing sub/tid claims");
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const device = req.headers.get("user-agent") ?? undefined;

    const res = await fetch(`${GATEWAY}/api/identity/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, userId, ip, device }),
    });
    if (!res.ok) {
      throw new Error(`identity-service POST /identity/sessions responded ${res.status}: ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    // SEC-027: this best-effort write had zero operational signal beyond a
    // raw console.error -- captureError() gives it a Prometheus counter
    // (captured_errors_total{service="web"}) and a structured log line an
    // operator can alert on. Context is userId/tenantId only -- never
    // accessToken/tokens -- matching what this codebase's other
    // captureError() call sites already treat as safe (see
    // services/identity-service/src/shared/keycloak.ts).
    captureError(err, {
      service: "web",
      event: "auth_callback_session_create_failed",
      userId,
      tenantId,
    });
    throw err;
  }
}
