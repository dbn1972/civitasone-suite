/** CLOS3-S5-09: helpdesk verifyAsset must hit asset-service's real detail route with internal credentials. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyAsset } from "../src/modules/cmdb/asset-client.js";

const SECRET = globalThis.crypto.randomUUID();
const TENANT = "11111111-2222-4000-8000-000000000509";
const ASSET = "22222222-3333-4000-8000-000000000509";

describe("verifyAsset (CLOS3-S5-09)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.INTERNAL_SERVICE_SECRET = SECRET;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("calls /v1/assets/assets/:id with x-internal, x-service-secret and x-tenant-id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: ASSET, name: "Laptop" }), { status: 200 }));
    await verifyAsset(ASSET, TENANT);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(`/v1/assets/assets/${ASSET}`);
    expect(init.headers).toMatchObject({ "x-internal": "1", "x-service-secret": SECRET, "x-tenant-id": TENANT });
  });

  it("a bare-asset 200 body verifies and carries the asset", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: ASSET, name: "Laptop" }), { status: 200 }));
    const r = await verifyAsset(ASSET, TENANT);
    expect(r).toMatchObject({ assetId: ASSET, verified: true, asset: { id: ASSET, name: "Laptop" } });
  });

  it("404 maps to asset_not_found", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await verifyAsset(ASSET, TENANT)).toMatchObject({ verified: false, error: "asset_not_found" });
  });

  it("fetch rejection maps to asset_service_unavailable and never throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await verifyAsset(ASSET, TENANT)).toMatchObject({ verified: false, error: "asset_service_unavailable" });
  });

  it("a missing secret yields verified:false without calling fetch", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(await verifyAsset(ASSET, TENANT)).toMatchObject({ verified: false, error: "asset_service_auth_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
