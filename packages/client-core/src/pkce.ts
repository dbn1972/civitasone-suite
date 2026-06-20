/**
 * OAuth 2.0 PKCE (RFC 7636) — shared by web and mobile native clients.
 * Keycloak public clients: civitasone-web, civitasone-mobile (S256).
 */

export type OidcConfig = {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
};

export type PkcePair = {
  codeVerifier: string;
  codeChallenge: string;
  method: "S256";
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier = randomString(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64UrlEncode(digest), method: "S256" };
}

export function buildAuthorizeUrl(
  config: OidcConfig,
  pkce: PkcePair,
  state: string,
  extra?: Record<string, string>,
): string {
  const base = config.issuerUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: (config.scopes ?? ["openid", "profile", "email", "offline_access"]).join(" "),
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.method,
    ...extra,
  });
  return `${base}/protocol/openid-connect/auth?${params}`;
}

export async function exchangeAuthorizationCode(
  config: OidcConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const base = config.issuerUrl.replace(/\/$/, "");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch(`${base}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`TOKEN_EXCHANGE_FAILED: ${res.status} ${detail}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(
  config: Pick<OidcConfig, "issuerUrl" | "clientId">,
  refreshToken: string,
): Promise<TokenResponse> {
  const base = config.issuerUrl.replace(/\/$/, "");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${base}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`TOKEN_REFRESH_FAILED: ${res.status}`);
  return res.json() as Promise<TokenResponse>;
}
