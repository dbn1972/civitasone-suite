import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSessionIdentity, resetSessionIdentityCache } from "./useSessionIdentity";

beforeEach(() => resetSessionIdentityCache());
afterEach(() => vi.unstubAllGlobals());

describe("useSessionIdentity", () => {
  it("returns the user id and roles from /api/auth/session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: true, userId: "u-1", roles: ["hr_admin", 7, "finance_officer"] }), { status: 200 })));
    const { result } = renderHook(() => useSessionIdentity());
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ loaded: true, userId: "u-1", roles: ["hr_admin", "finance_officer"] });
  });

  it("is loaded-but-empty when signed out or when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })));
    const a = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    expect(a.result.current.roles).toEqual([]);
    resetSessionIdentityCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const b = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    expect(b.result.current).toEqual({ loaded: true, userId: null, roles: [] });
  });
});
