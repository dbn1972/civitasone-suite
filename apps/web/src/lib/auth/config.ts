import type { OidcConfig } from "@civitasone/client-core";

export function getOidcConfig(): OidcConfig {
  const issuerUrl = process.env.KEYCLOAK_ISSUER_URL
    ?? process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER_URL
    ?? "http://localhost:8180/realms/civitasone";
  return {
    issuerUrl,
    clientId: process.env.KEYCLOAK_CLIENT_ID ?? process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "civitasone-web",
    redirectUri: process.env.KEYCLOAK_REDIRECT_URI
      ?? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/callback`,
    scopes: ["openid", "profile", "email", "offline_access"],
  };
}

export const COOKIE = {
  ACCESS: "civitasone_at",
  REFRESH: "civitasone_rt",
  PKCE_VERIFIER: "civitasone_pkce_verifier",
  OAUTH_STATE: "civitasone_oauth_state",
  DEVICE_ID: "civitasone_device_id",
  DEVICE_TRUST: "civitasone_device_trust",
} as const;
