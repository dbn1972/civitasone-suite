import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("GET /api/auth/forgot (GAP-AUTH-FORGOT-01)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("KEYCLOAK_ISSUER_URL", "https://kc.example.gov.in/realms/civitasone");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to the Keycloak reset-credentials page (no fabricated email flow)", async () => {
    const { GET } = await import("./route");
    const res = GET();
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("https://kc.example.gov.in/realms/civitasone/login-actions/reset-credentials");
    expect(loc).toContain("client_id=");
  });
});
