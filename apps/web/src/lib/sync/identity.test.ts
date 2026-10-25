import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveNamespace, clearNamespaceCache } from "./identity";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe("resolveNamespace (CLOS3-S3-06)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    clearNamespaceCache();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a transient network failure is not cached: the next call retries and gets the real namespace", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    fetchMock.mockResolvedValueOnce(ok({ authenticated: true, tenantId: "t", userId: "u" }));
    expect(await resolveNamespace()).toBeNull();
    expect(await resolveNamespace()).toEqual({ tenantId: "t", userId: "u" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a non-OK reply (e.g. 503) is retried too", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);
    fetchMock.mockResolvedValueOnce(ok({ authenticated: true, tenantId: "t", userId: "u" }));
    expect(await resolveNamespace()).toBeNull();
    expect(await resolveNamespace()).toEqual({ tenantId: "t", userId: "u" });
  });

  it("a success is cached: concurrent and later calls share one request", async () => {
    fetchMock.mockResolvedValue(ok({ authenticated: true, tenantId: "t", userId: "u" }));
    const [a, b] = await Promise.all([resolveNamespace(), resolveNamespace()]);
    expect(a).toEqual({ tenantId: "t", userId: "u" });
    expect(b).toBe(a);
    await resolveNamespace();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a definite 'not authenticated' answer stays cached until logout clears it", async () => {
    fetchMock.mockResolvedValue(ok({ authenticated: false }));
    expect(await resolveNamespace()).toBeNull();
    expect(await resolveNamespace()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearNamespaceCache();
    await resolveNamespace();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
