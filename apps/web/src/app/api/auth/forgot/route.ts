import { NextResponse } from "next/server";
import { getOidcConfig } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GAP-AUTH-FORGOT-01 / FORGOT-03 / FORGOT-06 / LOGIN-01:
 *
 * Authentication is delegated to Keycloak (OIDC), so password recovery is
 * owned by Keycloak's realm, not by a bespoke web email flow. The previous UI
 * POSTed to a non-existent endpoint and always claimed "we've sent an email",
 * which was a false assurance (no reset mail was ever sent).
 *
 * This route sends the user to Keycloak's reset-credentials page, derived from
 * the configured OIDC issuer. If the realm has the "Forgot password" flow
 * enabled, Keycloak owns token issuance, single-use/expiry semantics and email
 * delivery — none of which the web app can honestly promise on its own.
 *
 * We deliberately do NOT fabricate an email-sent confirmation here.
 */
export function GET(): NextResponse {
  const { issuerUrl, clientId, redirectUri } = getOidcConfig();
  const base = issuerUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
  });
  const resetUrl = `${base}/login-actions/reset-credentials?${params.toString()}`;
  return NextResponse.redirect(resetUrl);
}
