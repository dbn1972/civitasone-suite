/**
 * notifyGatewayModuleCache (ST-M01-02): admin-service tells the gateway app to
 * drop its module-guard cache over the authenticated internal endpoint after a
 * module toggle / composition apply commits. Best-effort: never throws.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyGatewayModuleCache } from "../src/module-cache-notify.js";

const TID = "22222222-3333-4000-8000-000000000001";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("notifyGatewayModuleCache", () => {
  it("POSTs the tenant id with the internal secret to the gateway invalidate endpoint", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_URL", "http://gw.test:9");
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "unit-test-internal-value");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await notifyGatewayModuleCache(TID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gw.test:9/internal/module-cache/invalidate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-internal-secret"]).toBe("unit-test-internal-value");
    expect(JSON.parse(init.body as string)).toEqual({ tenantId: TID });
  });

  it("never throws when the gateway is unreachable or refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(notifyGatewayModuleCache(TID)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    await expect(notifyGatewayModuleCache(TID)).resolves.toBeUndefined();
  });
});
