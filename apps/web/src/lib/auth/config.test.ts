import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOidcConfig, COOKIE } from "./config";

describe("getOidcConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to clean state
    delete process.env.KEYCLOAK_ISSUER_URL;
    delete process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER_URL;
    delete process.env.KEYCLOAK_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
    delete process.env.KEYCLOAK_REDIRECT_URI;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("returns default issuer URL when env is not set", () => {
    const config = getOidcConfig();
    expect(config.issuerUrl).toBe("http://localhost:8180/realms/civitasone");
  });

  it("uses KEYCLOAK_ISSUER_URL when set", () => {
    process.env.KEYCLOAK_ISSUER_URL = "https://auth.gov.in/realms/civitasone";
    const config = getOidcConfig();
    expect(config.issuerUrl).toBe("https://auth.gov.in/realms/civitasone");
  });

  it("falls back to NEXT_PUBLIC_ variant", () => {
    process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER_URL = "https://public.auth.in/realms/civitasone";
    const config = getOidcConfig();
    expect(config.issuerUrl).toBe("https://public.auth.in/realms/civitasone");
  });

  it("returns default client ID", () => {
    const config = getOidcConfig();
    expect(config.clientId).toBe("civitasone-web");
  });

  it("includes required scopes", () => {
    const config = getOidcConfig();
    expect(config.scopes).toContain("openid");
    expect(config.scopes).toContain("profile");
    expect(config.scopes).toContain("offline_access");
  });

  it("constructs redirect URI from app URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.civitasone.gov.in";
    const config = getOidcConfig();
    expect(config.redirectUri).toBe("https://app.civitasone.gov.in/api/auth/callback");
  });

  it("uses KEYCLOAK_REDIRECT_URI directly if set", () => {
    process.env.KEYCLOAK_REDIRECT_URI = "https://custom.gov.in/callback";
    const config = getOidcConfig();
    expect(config.redirectUri).toBe("https://custom.gov.in/callback");
  });
});

describe("COOKIE constants", () => {
  it("has access token cookie name", () => {
    expect(COOKIE.ACCESS).toBe("civitasone_at");
  });

  it("has refresh token cookie name", () => {
    expect(COOKIE.REFRESH).toBe("civitasone_rt");
  });

  it("has device ID cookie name", () => {
    expect(COOKIE.DEVICE_ID).toBe("civitasone_device_id");
  });

  it("has PKCE verifier cookie name", () => {
    expect(COOKIE.PKCE_VERIFIER).toBe("civitasone_pkce_verifier");
  });
});
