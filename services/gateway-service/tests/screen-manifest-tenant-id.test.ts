import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";
import { registerScreenManifestRoute } from "../src/screen-manifest.js";

/** CodeQL js/request-forgery (#929): x-tenant-id is a URL path segment toward tenant-service. */
const TID = "11111111-2222-4000-8000-000000000001";

async function appWithFetch() {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ edition: "small_office", settings: null }) }));
  vi.stubGlobal("fetch", fetchSpy);
  const app = Fastify();
  registerScreenManifestRoute(app);
  await app.ready();
  return { app, fetchSpy };
}
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/v1/config/screens tenant id handling", () => {
  it.each(["../../internal/x", "abc", "a/b", "1?x=y"])("rejects non-UUID tenant %j with 400 and makes no upstream call", async (bad) => {
    const { app, fetchSpy } = await appWithFetch();
    const res = await app.inject({ method: "GET", url: "/api/v1/config/screens", headers: { "x-tenant-id": bad } });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("401 without a tenant, 200 with a canonical UUID (one upstream call)", async () => {
    const { app, fetchSpy } = await appWithFetch();
    expect((await app.inject({ method: "GET", url: "/api/v1/config/screens" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/config/screens", headers: { "x-tenant-id": TID } })).statusCode).toBe(200);
    await app.close();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toContain(`/v1/tenants/${TID}`);
  });
});
