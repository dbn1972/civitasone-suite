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

describe("useSessionIdentity failure caching (CLOS3-S3-07)", () => {
  const authed = (): Response => new Response(JSON.stringify({ authenticated: true, userId: "u-1", roles: ["hr_admin"] }), { status: 200 });

  it("does not cache a thrown fetch: the next mount retries and recovers", async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => authed());
    vi.stubGlobal("fetch", f);
    const a = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    expect(a.result.current.userId).toBeNull();
    a.unmount();
    const b = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(b.result.current.userId).toBe("u-1"));
    expect(b.result.current.roles).toEqual(["hr_admin"]);
  });

  it("caches a valid signed-out answer (no refetch on the next mount)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const a = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    a.unmount();
    const b = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries after a 500", async () => {
    const f = vi.fn()
      .mockImplementationOnce(async () => new Response("boom", { status: 500 }))
      .mockImplementation(async () => authed());
    vi.stubGlobal("fetch", f);
    const a = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    a.unmount();
    const b = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(b.result.current.userId).toBe("u-1"));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("concurrent mounts share one request", async () => {
    const f = vi.fn(async () => authed());
    vi.stubGlobal("fetch", f);
    const a = renderHook(() => useSessionIdentity());
    const b = renderHook(() => useSessionIdentity());
    await waitFor(() => expect(a.result.current.userId).toBe("u-1"));
    await waitFor(() => expect(b.result.current.userId).toBe("u-1"));
    expect(f).toHaveBeenCalledTimes(1);
  });
});
