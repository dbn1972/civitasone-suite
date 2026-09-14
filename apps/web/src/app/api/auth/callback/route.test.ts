import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";
import { exchangeAuthorizationCode } from "@civitasone/client-core";
import { decodeUnverifiedClaims } from "@civitasone/auth";
import { captureError } from "@civitasone/observability";
import { COOKIE } from "@/lib/auth/config";

// Overrides the blanket next/headers mock from vitest.setup.ts: this suite
// needs cookies().get() to return real OAUTH_STATE/PKCE_VERIFIER values so
// the callback's state/PKCE guard (route.ts) doesn't short-circuit before
// reaching the session-creation path under test.
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@civitasone/client-core", () => ({
  exchangeAuthorizationCode: vi.fn(),
}));

vi.mock("@civitasone/auth", () => ({
  decodeUnverifiedClaims: vi.fn(),
}));

vi.mock("@civitasone/observability", () => ({
  captureError: vi.fn(),
}));

const STATE = "test-oauth-state";
const VERIFIER = "test-pkce-verifier";
const USER_ID = "user-42";
const TENANT_ID = "tenant-9";
const ACCESS_TOKEN = "fake-access-token";

function makeCookieJar() {
  const store: Record<string, string> = {
    [COOKIE.OAUTH_STATE]: STATE,
    [COOKIE.PKCE_VERIFIER]: VERIFIER,
  };
  return {
    get: (name: string) => (store[name] !== undefined ? { value: store[name] } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

function callbackRequest() {
  return new Request(`https://civitasone.example.gov.in/api/auth/callback?code=auth-code-1&state=${STATE}`);
}

describe("GET /api/auth/callback -- SEC-027 session-creation failure signal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockReturnValue(makeCookieJar() as unknown as ReturnType<typeof cookies>);
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
      access_token: ACCESS_TOKEN,
      refresh_token: "fake-refresh-token",
      expires_in: 300,
    } as Awaited<ReturnType<typeof exchangeAuthorizationCode>>);
    vi.mocked(decodeUnverifiedClaims).mockReturnValue({ sub: USER_ID, tid: TENANT_ID } as ReturnType<typeof decodeUnverifiedClaims>);
    global.fetch = vi.fn();
  });

  it("reports a failed backend session creation via captureError, with no token/secret in the captured context", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "identity-service unavailable",
    } as Response);

    const { GET } = await import("./route");
    const res = await GET(callbackRequest());

    // DoD: a real, queryable signal fires -- not just a console line.
    expect(captureError).toHaveBeenCalledTimes(1);
    const [err, ctx] = vi.mocked(captureError).mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toContain("503");
    expect(ctx).toMatchObject({
      service: "web",
      event: "auth_callback_session_create_failed",
      userId: USER_ID,
      tenantId: TENANT_ID,
    });
    // No secret/token ever enters the captured context.
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(Object.keys(ctx as object).join(",").toLowerCase()).not.toMatch(/token|secret/);

    // Fail-open contract (SEC-015) is unchanged: the login still completes.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("does not call captureError when backend session creation succeeds", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 201, text: async () => "" } as Response);

    const { GET } = await import("./route");
    const res = await GET(callbackRequest());

    expect(captureError).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("reports a claims-decode failure via captureError too (decode now runs inside the guarded region)", async () => {
    vi.mocked(decodeUnverifiedClaims).mockImplementation(() => {
      throw new Error("malformed token");
    });

    const { GET } = await import("./route");
    const res = await GET(callbackRequest());

    // Review note: decodeUnverifiedClaims() used to run outside the try
    // block, so a throw here would bypass captureError() entirely. It's now
    // inside the guarded region -- confirm the failure never reaches fetch
    // and is still captured.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(1);
    const [err, ctx] = vi.mocked(captureError).mock.calls[0];
    expect(String((err as Error).message)).toContain("malformed token");
    expect(ctx).toMatchObject({ service: "web", event: "auth_callback_session_create_failed" });
    // userId/tenantId were never assigned in this failure mode -- must stay
    // absent, not get silently coerced into a misleading placeholder.
    expect((ctx as Record<string, unknown>).userId).toBeUndefined();
    expect((ctx as Record<string, unknown>).tenantId).toBeUndefined();

    // Fail-open contract still holds even for this earlier failure point.
    expect(res.headers.get("location")).toContain("/dashboard");
  });
});
