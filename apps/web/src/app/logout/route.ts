import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, getOidcConfig } from "@/lib/auth/config";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://civitasone.65-2-205-201.nip.io";

// Bug fix: this route used to only clear the app's own cookies and redirect
// to /auth/login (using request.url, which resolves to localhost when the
// app is accessed through a reverse proxy under a different public host).
// It also never terminated the Keycloak SSO session, so the browser's
// KEYCLOAK_SESSION cookie stayed valid — /auth/login would then silently
// re-authenticate via SSO and bounce straight back into the app, meaning
// "logout" never actually logged the user out at the identity provider.
// Redirect through Keycloak's RP-initiated logout endpoint instead, with
// post_logout_redirect_uri pointing back at our own public login page.
export async function GET(request: NextRequest) {
  const cookieStore = cookies();
  cookieStore.delete(COOKIE.ACCESS);
  cookieStore.delete(COOKIE.REFRESH);
  cookieStore.delete(COOKIE.DEVICE_TRUST);
  // Also clear any leftover OAuth-flow artifacts from a prior failed
  // callback attempt, so logout always leaves a genuinely clean slate
  // for the next login, not just a clean app-session.
  cookieStore.delete(COOKIE.PKCE_VERIFIER);
  cookieStore.delete(COOKIE.OAUTH_STATE);

  const oidc = getOidcConfig();
  const logoutUrl = new URL(`${oidc.issuerUrl}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set("client_id", oidc.clientId);
  logoutUrl.searchParams.set(
    "post_logout_redirect_uri",
    new URL("/auth/login", APP_URL).toString(),
  );

  return NextResponse.redirect(logoutUrl);
}
