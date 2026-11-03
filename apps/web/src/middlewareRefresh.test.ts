import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { refreshAccessToken } from "@civitasone/client-core";
import { middleware } from "./middleware";
import { COOKIE } from "@/lib/auth/config";
import { __resetRefreshFlightsForTests } from "@/lib/auth/tokenRefresh";

// A11Y-01 (WCAG 2.2.1): the middleware silently renews an expiring session
// with the stored refresh token instead of redirecting to login, and ends the
// session cleanly when Keycloak rejects the refresh token.

vi.mock("@civitasone/client-core", () => ({ refreshAccessToken: vi.fn() }));

const nowSec = () => Math.floor(Date.now() / 1000);

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

const freshAt = () => jwt({ sub: "u", exp: nowSec() + 1500 });
const expiringAt = () => jwt({ sub: "u", exp: nowSec() + 20 });
const expiredAt = () => jwt({ sub: "u", exp: nowSec() - 10 });
const liveRt = () => jwt({ typ: "Refresh", iat: nowSec() - 1700, exp: nowSec() + 100 });
const offlineRt = () => jwt({ typ: "Offline", iat: nowSec() - 100 });

function req(path: string, cookies: Record<string, string>, method = "GET"): NextRequest {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(`https://demo.test${path}`), { method, headers: cookie ? { cookie } : {} });
}

function newTokens() {
  return {
    access_token: jwt({ sub: "u", exp: nowSec() + 1800, n: "new" }),
    refresh_token: jwt({ typ: "Refresh", iat: nowSec(), exp: nowSec() + 1800, n: "new" }),
    expires_in: 1800,
    refresh_expires_in: 1800,
    token_type: "Bearer",
  };
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

describe("middleware silent refresh (A11Y-01)", () => {
  beforeEach(() => {
    __resetRefreshFlightsForTests();
    vi.mocked(refreshAccessToken).mockReset();
  });

  it("leaves a fresh session alone (no Keycloak call)", async () => {
    const res = await middleware(req("/dashboard", { [COOKIE.ACCESS]: freshAt(), [COOKIE.REFRESH]: liveRt() }));
    expect(res.status).toBe(200);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", () => ({ [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() })],
    ["about to expire", () => ({ [COOKIE.ACCESS]: expiringAt(), [COOKIE.REFRESH]: liveRt() })],
    ["aged-out (cookie gone)", () => ({ [COOKIE.REFRESH]: liveRt() })],
  ])("renews an %s access token instead of redirecting to login", async (_label, cookies) => {
    const tokens = newTokens();
    vi.mocked(refreshAccessToken).mockResolvedValue(tokens);
    const res = await middleware(req("/finance/journal/new", cookies()));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    // Persisted in the browser with Keycloak's lifetimes and safe flags...
    const at = setCookie(res, COOKIE.ACCESS)!;
    expect(at).toContain(tokens.access_token);
    expect(at).toMatch(/HttpOnly/i);
    expect(at).toMatch(/SameSite=strict/i);
    expect(at).toMatch(/Path=\//);
    expect(at).toMatch(/Max-Age=1800/);
    expect(setCookie(res, COOKIE.REFRESH)).toContain(tokens.refresh_token);
    // ...and handed to this same request's downstream handler (layout / API proxy).
    expect(res.headers.get("x-middleware-request-cookie")).toContain(tokens.access_token);
  });

  it("is single-flight across concurrent requests carrying the same refresh token", async () => {
    const tokens = newTokens();
    vi.mocked(refreshAccessToken).mockImplementation(() => new Promise((r) => setTimeout(() => r(tokens), 10)));
    const cookies = { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() };
    const results = await Promise.all([
      middleware(req("/api/proxy/finance/vouchers", cookies)),
      middleware(req("/api/proxy/hr/employees", cookies)),
      middleware(req("/dashboard", cookies)),
    ]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    for (const r of results) expect(setCookie(r, COOKIE.ACCESS)).toContain(tokens.access_token);
  });

  it("signs a page request out to login with the session-expired message and return URL when Keycloak rejects the token", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("TOKEN_REFRESH_FAILED: 400"));
    const res = await middleware(req("/hr/employees/new?step=2", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() }));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/auth/login");
    expect(loc.searchParams.get("error")).toBe("session_expired");
    expect(loc.searchParams.get("next")).toBe("/hr/employees/new?step=2");
    for (const name of [COOKIE.ACCESS, COOKIE.REFRESH]) {
      const c = setCookie(res, name)!;
      expect(c).toMatch(/Max-Age=0/);
      expect(c).toMatch(/Path=\//);
    }
  });

  it("answers an API request with JSON 401 SESSION_EXPIRED (not a login-page redirect) on refresh failure", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("TOKEN_REFRESH_FAILED: 400"));
    const res = await middleware(req("/api/proxy/finance/vouchers", { [COOKIE.REFRESH]: liveRt() }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("does not sign the user out when Keycloak is merely unreachable and the token is still valid", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new TypeError("fetch failed"));
    const res = await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiringAt(), [COOKIE.REFRESH]: liveRt() }));
    expect(res.status).toBe(200);
    expect(setCookie(res, COOKIE.ACCESS)).toBeUndefined();
  });

  it("never silently refreshes with an offline token (legacy sessions fall back to the old login redirect)", async () => {
    const res = await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: offlineRt() }));
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("answers an API call with JSON 401 SESSION_EXPIRED (not a login redirect) when the token has expired and Keycloak is unreachable, keeping the cookies", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new TypeError("fetch failed"));
    const res = await middleware(req("/api/proxy/finance/vouchers", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() }));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toMatchObject({ code: "SESSION_EXPIRED" });
    // the refresh token is still good: nothing is cleared, so the session resumes after the outage
    expect(setCookie(res, COOKIE.REFRESH)).toBeUndefined();
    expect(setCookie(res, COOKIE.ACCESS)).toBeUndefined();
  });

  it("still sends a page request to login when the token has expired and Keycloak is unreachable", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new TypeError("fetch failed"));
    const res = await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("does not hit Keycloak on every request during an outage (short negative cache)", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new TypeError("fetch failed"));
    const cookies = { [COOKIE.ACCESS]: expiringAt(), [COOKIE.REFRESH]: liveRt() };
    await middleware(req("/dashboard", cookies));
    await middleware(req("/api/proxy/hr/employees", cookies));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it.each(["/logout", "/api/auth/logout"])("clears the refresh cache on sign-out (%s) so a rotated token can't be replayed from it", async (path) => {
    const tokens = newTokens();
    vi.mocked(refreshAccessToken).mockResolvedValue(tokens);
    const oldRt = liveRt();
    await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: oldRt }));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    // Without sign-out the old token would be served from the grace cache...
    const signOut = await middleware(req(path, { [COOKIE.ACCESS]: tokens.access_token, [COOKIE.REFRESH]: tokens.refresh_token }, path === "/logout" ? "GET" : "POST"));
    expect(signOut.status).toBe(200);
    // ...after it, replaying the rotated token goes to Keycloak (which rejects it).
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("TOKEN_REFRESH_FAILED: 400"));
    const replay = await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: oldRt }));
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(new URL(replay.headers.get("location")!).searchParams.get("error")).toBe("session_expired");
  });

  describe("Set-Cookie flags", () => {
    afterEach(() => vi.unstubAllEnvs());

    function assertFlags(cookie: string | undefined, maxAge: number, secure: boolean) {
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Strict/i);
      expect(cookie).toMatch(/;\s*Path=\/(;|$)/);
      expect(cookie).toMatch(new RegExp(`;\\s*Max-Age=${maxAge}(;|$)`));
      if (secure) expect(cookie).toMatch(/;\s*Secure/i);
      else expect(cookie).not.toMatch(/;\s*Secure/i);
    }

    it("refresh success (production): both cookies HttpOnly, SameSite=Strict, Secure, Path=/, Max-Age from Keycloak", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const tokens = { ...newTokens(), expires_in: 900, refresh_expires_in: 1700 };
      vi.mocked(refreshAccessToken).mockResolvedValue(tokens);
      const res = await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() }));
      assertFlags(setCookie(res, COOKIE.ACCESS), 900, true);
      assertFlags(setCookie(res, COOKIE.REFRESH), 1700, true);
    });

    it("cleared cookies (production): same flags with Max-Age=0", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.mocked(refreshAccessToken).mockRejectedValue(new Error("TOKEN_REFRESH_FAILED: 400"));
      for (const path of ["/dashboard", "/api/proxy/x"]) {
        __resetRefreshFlightsForTests();
        const res = await middleware(req(path, { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() }));
        assertFlags(setCookie(res, COOKIE.ACCESS), 0, true);
        assertFlags(setCookie(res, COOKIE.REFRESH), 0, true);
      }
    });

    it("omits Secure outside production (plain-http local dev)", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.mocked(refreshAccessToken).mockResolvedValue(newTokens());
      const res = await middleware(req("/dashboard", { [COOKIE.ACCESS]: expiredAt(), [COOKIE.REFRESH]: liveRt() }));
      assertFlags(setCookie(res, COOKIE.ACCESS), 1800, false);
      assertFlags(setCookie(res, COOKIE.REFRESH), 1800, false);
    });
  });

  describe("POST /api/auth/refresh (Stay signed in)", () => {
    it("forces a refresh even while the access token is fresh", async () => {
      const tokens = newTokens();
      vi.mocked(refreshAccessToken).mockResolvedValue(tokens);
      const res = await middleware(req("/api/auth/refresh", { [COOKIE.ACCESS]: freshAt(), [COOKIE.REFRESH]: liveRt() }, "POST"));
      expect(res.status).toBe(200);
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(setCookie(res, COOKIE.REFRESH)).toContain(tokens.refresh_token);
    });

    it("reports 401 SESSION_EXPIRED and clears cookies when the refresh token is rejected", async () => {
      vi.mocked(refreshAccessToken).mockRejectedValue(new Error("TOKEN_REFRESH_FAILED: 400"));
      const res = await middleware(req("/api/auth/refresh", { [COOKIE.ACCESS]: freshAt(), [COOKIE.REFRESH]: liveRt() }, "POST"));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "SESSION_EXPIRED" });
      expect(setCookie(res, COOKIE.ACCESS)).toMatch(/Max-Age=0/);
    });

    it("reports 503 (retryable) when Keycloak is unreachable", async () => {
      vi.mocked(refreshAccessToken).mockRejectedValue(new TypeError("fetch failed"));
      const res = await middleware(req("/api/auth/refresh", { [COOKIE.ACCESS]: freshAt(), [COOKIE.REFRESH]: liveRt() }, "POST"));
      expect(res.status).toBe(503);
    });

    it("reports 409 NOT_REFRESHABLE for a valid session without a usable refresh token", async () => {
      const res = await middleware(req("/api/auth/refresh", { [COOKIE.ACCESS]: freshAt(), [COOKIE.REFRESH]: offlineRt() }, "POST"));
      expect(res.status).toBe(409);
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it("leaves GET /api/auth/refresh (timing only) as a plain public pass-through", async () => {
      const res = await middleware(req("/api/auth/refresh", { [COOKIE.ACCESS]: freshAt(), [COOKIE.REFRESH]: liveRt() }));
      expect(res.status).toBe(200);
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });
  });
});
