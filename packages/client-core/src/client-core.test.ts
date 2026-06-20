import { describe, it, expect } from "vitest";
import { generatePkcePair, buildAuthorizeUrl } from "./pkce.js";
import { buildSecurityHeaders, sessionFromTokens } from "./session.js";
import { shouldRetryOutbox } from "./sync/index.js";

describe("PKCE", () => {
  it("generates S256 challenge from verifier", async () => {
    const pair = await generatePkcePair();
    expect(pair.codeVerifier.length).toBeGreaterThan(40);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.method).toBe("S256");
  });

  it("buildAuthorizeUrl includes PKCE params", async () => {
    const pair = await generatePkcePair();
    const url = buildAuthorizeUrl(
      { issuerUrl: "http://localhost:8180/realms/civitasone", clientId: "civitasone-web", redirectUri: "http://localhost:3000/api/auth/callback" },
      pair,
      "state-123",
    );
    expect(url).toContain("code_challenge=");
    expect(url).toContain("code_challenge_method=S256");
  });
});

describe("session security headers", () => {
  it("includes device and bearer headers", () => {
    const session = sessionFromTokens({
      accessToken: "tok",
      expiresIn: 3600,
      deviceId: "dev-1",
      deviceTrustToken: "trust-abc",
    });
    const h = buildSecurityHeaders(session, "corr-1");
    expect(h.authorization).toBe("Bearer tok");
    expect(h["x-device-id"]).toBe("dev-1");
    expect(h["x-device-trust-token"]).toBe("trust-abc");
  });
});

describe("sync outbox retry", () => {
  it("retries failed entries under max", () => {
    expect(shouldRetryOutbox({
      id: "1", mailbox: "approvals", operation: "update",
      payload: {}, createdAt: new Date().toISOString(),
      status: "failed", retryCount: 2,
    })).toBe(true);
  });
});
