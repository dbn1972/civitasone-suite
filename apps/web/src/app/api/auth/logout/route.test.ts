import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { endKeycloakSession, forgetRefreshToken } from "@/lib/auth/tokenRefresh";
import { COOKIE } from "@/lib/auth/config";

// A11Y-01 hardening: both sign-out routes drop the refresh cache entries for
// the user's refresh token and end the Keycloak session before clearing cookies.

const jar = vi.hoisted(() => ({
  values: {} as Record<string, string>,
  deleted: [] as string[],
}));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => (jar.values[n] !== undefined ? { value: jar.values[n] } : undefined),
    set: vi.fn(),
    delete: (n: string) => jar.deleted.push(n),
  }),
}));
vi.mock("@/lib/auth/tokenRefresh", () => ({
  forgetRefreshToken: vi.fn(async () => {}),
  endKeycloakSession: vi.fn(async () => {}),
}));

import { POST as apiLogout } from "./route";
import { GET as pageLogout } from "@/app/logout/route";

describe("sign-out routes", () => {
  beforeEach(() => {
    jar.values = { [COOKIE.ACCESS]: "at-1", [COOKIE.REFRESH]: "rt-1" };
    jar.deleted = [];
    vi.mocked(forgetRefreshToken).mockClear();
    vi.mocked(endKeycloakSession).mockClear();
  });

  it("POST /api/auth/logout forgets the cached refresh outcome, ends the Keycloak session, clears cookies", async () => {
    const res = await apiLogout();
    expect(res.status).toBe(200);
    expect(forgetRefreshToken).toHaveBeenCalledWith("rt-1");
    expect(endKeycloakSession).toHaveBeenCalledWith("rt-1");
    expect(jar.deleted).toEqual(expect.arrayContaining([COOKIE.ACCESS, COOKIE.REFRESH]));
  });

  it("GET /logout does the same before the RP-initiated Keycloak redirect", async () => {
    const res = await pageLogout(new NextRequest(new URL("https://demo.test/logout")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/protocol/openid-connect/logout");
    expect(forgetRefreshToken).toHaveBeenCalledWith("rt-1");
    expect(endKeycloakSession).toHaveBeenCalledWith("rt-1");
    expect(jar.deleted).toEqual(expect.arrayContaining([COOKIE.ACCESS, COOKIE.REFRESH]));
  });
});
