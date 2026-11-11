/** UAT B23: procurement's read-only inventory pre-check client - request shape and fail-open behaviour. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getInventoryPrecheckFailopenCount, resetFailureMetrics } from "@civitasone/observability";
import { precheckGrnStock } from "../src/shared/inventory-client.js";

const TENANT = "11111111-0000-0000-0000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("precheckGrnStock", () => {
  it("posts the SKUs and store to inventory with the internal-service headers and returns the verdict", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ unknownSkus: ["X-1"], ambiguousSkus: [], storeKnown: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await precheckGrnStock(TENANT, ["X-1", "Y-2"], "22222222-0000-0000-0000-000000000009");
    expect(out).toEqual({ unknownSkus: ["X-1"], ambiguousSkus: [], storeKnown: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/inventory\/grn-precheck$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-internal"]).toBe("1");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe(TENANT);
    expect(JSON.parse(init.body as string)).toEqual({ skus: ["X-1", "Y-2"], storeId: "22222222-0000-0000-0000-000000000009" });
  });

  it("returns null (caller must not refuse) when inventory is unreachable, errors, or replies with junk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await precheckGrnStock(TENANT, ["X-1"])).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));
    expect(await precheckGrnStock(TENANT, ["X-1"])).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })));
    expect(await precheckGrnStock(TENANT, ["X-1"])).toBeNull();
  });

  it("counts each fail-open by reason and warns once per reason without leaking the secret", async () => {
    resetFailureMetrics();
    process.env.INTERNAL_SERVICE_SECRET = "s3cret-value-for-test-only";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await precheckGrnStock(TENANT, ["X-1"]);
    await precheckGrnStock(TENANT, ["X-1"]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await precheckGrnStock(TENANT, ["X-1"]);
    expect(getInventoryPrecheckFailopenCount("http_401")).toBe(2);
    expect(getInventoryPrecheckFailopenCount("unreachable")).toBe(1);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("http_401"))).toHaveLength(1);
    expect(lines.join("")).not.toContain("s3cret");
    warn.mockRestore();
  });
});
