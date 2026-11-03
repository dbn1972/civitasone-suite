import { describe, it, expect } from "vitest";
import { COOKIE } from "./config";
import {
  clearedSessionCookieSpecs,
  describeSessionTimes,
  isSilentRefreshToken,
  LEGACY_REFRESH_MAX_AGE_SEC,
  refreshCookieMaxAge,
  sessionCookieSpecs,
} from "./sessionCookies";

const NOW = 1_800_000_000;

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

const RT = jwt({ typ: "Refresh", iat: NOW, exp: NOW + 1800 });
const OFFLINE_RT = jwt({ typ: "Offline", iat: NOW });

describe("sessionCookieSpecs", () => {
  it("stores only the access and refresh tokens, httpOnly + SameSite=Strict on path /", () => {
    const specs = sessionCookieSpecs({ access_token: "at", refresh_token: RT, id_token: "idt", expires_in: 1800, refresh_expires_in: 1800, token_type: "Bearer" }, NOW);
    expect(specs.map((s) => s.name)).toEqual([COOKIE.ACCESS, COOKIE.REFRESH]);
    expect(specs.some((s) => s.value === "idt")).toBe(false);
    for (const s of specs) expect(s.options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
  });

  it("takes both cookie lifetimes from Keycloak's response, not a fixed 30 days", () => {
    const [at, rt] = sessionCookieSpecs({ access_token: "at", refresh_token: RT, expires_in: 300, refresh_expires_in: 1200, token_type: "Bearer" }, NOW);
    expect(at!.options.maxAge).toBe(300);
    expect(rt!.options.maxAge).toBe(1200);
  });

  it("omits the refresh cookie when Keycloak returns no refresh token", () => {
    expect(sessionCookieSpecs({ access_token: "at", expires_in: 60, token_type: "Bearer" }, NOW)).toHaveLength(1);
  });
});

describe("refreshCookieMaxAge", () => {
  it("falls back to the refresh token's exp claim, then to the legacy lifetime", () => {
    expect(refreshCookieMaxAge({ access_token: "a", refresh_token: RT, expires_in: 1, token_type: "Bearer" }, NOW + 100)).toBe(1700);
    expect(refreshCookieMaxAge({ access_token: "a", refresh_token: OFFLINE_RT, expires_in: 1, refresh_expires_in: 0, token_type: "Bearer" }, NOW)).toBe(LEGACY_REFRESH_MAX_AGE_SEC);
  });
});

describe("isSilentRefreshToken", () => {
  it("accepts a live, SSO-bound refresh token", () => {
    expect(isSilentRefreshToken(RT, NOW + 10)).toBe(true);
  });
  it("refuses offline tokens (they bypass the SSO idle/max lifetimes)", () => {
    expect(isSilentRefreshToken(OFFLINE_RT, NOW)).toBe(false);
  });
  it("refuses expired, missing and malformed tokens", () => {
    expect(isSilentRefreshToken(RT, NOW + 1800)).toBe(false);
    expect(isSilentRefreshToken(undefined, NOW)).toBe(false);
    expect(isSilentRefreshToken("not-a-jwt", NOW)).toBe(false);
  });
});

describe("clearedSessionCookieSpecs", () => {
  it("expires both cookies on path / (so they are really removed)", () => {
    const specs = clearedSessionCookieSpecs();
    expect(specs.map((s) => s.name)).toEqual([COOKIE.ACCESS, COOKIE.REFRESH]);
    for (const s of specs) expect(s).toMatchObject({ value: "", options: { maxAge: 0, path: "/" } });
  });
});

describe("describeSessionTimes", () => {
  it("reports expiries, the idle window (exp - iat) and refreshability -- never token material", () => {
    const at = jwt({ exp: NOW + 1800, iat: NOW });
    const times = describeSessionTimes(at, RT, (NOW + 60) * 1000);
    expect(times).toEqual({
      authenticated: true,
      accessExpiresAt: (NOW + 1800) * 1000,
      sessionExpiresAt: (NOW + 1800) * 1000,
      idleTimeoutSec: 1800,
      refreshable: true,
    });
    expect(JSON.stringify(times)).not.toContain(at);
  });

  it("is unauthenticated with no cookies, and not refreshable with an offline token", () => {
    expect(describeSessionTimes(undefined, undefined, NOW * 1000).authenticated).toBe(false);
    const t = describeSessionTimes(jwt({ exp: NOW + 60 }), OFFLINE_RT, NOW * 1000);
    expect(t).toMatchObject({ authenticated: true, refreshable: false, sessionExpiresAt: null, idleTimeoutSec: null });
  });

  it("stays authenticated on a refreshable session whose access cookie already aged out", () => {
    expect(describeSessionTimes(undefined, RT, (NOW + 5) * 1000)).toMatchObject({ authenticated: true, refreshable: true, accessExpiresAt: null });
  });
});
