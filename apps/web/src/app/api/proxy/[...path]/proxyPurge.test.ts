import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const purge = vi.fn();
vi.mock("@/lib/dataCache", async (io) => ({ ...(await io<Record<string, unknown>>()), purgeTenantDataCache: (t: string) => purge(t) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "tok" }) }) }));

import { GET, POST, DELETE } from "./route";

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("BFF proxy purges the data cache after a committed write (UAT b23 P1)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); purge.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("purges after a successful POST", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await POST(new Request("http://x/api/proxy/v1/procurement/indents/i1/approve", { method: "POST", body: "{}" }), params(["v1", "procurement", "indents", "i1", "approve"]));
    expect(purge).toHaveBeenCalledWith("tok");
  });

  it("purges after a successful DELETE returning 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await DELETE(new Request("http://x/api/proxy/v1/a/b", { method: "DELETE" }), params(["v1", "a", "b"]));
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("does not purge for a rejected write (4xx/5xx)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 422 }));
    await POST(new Request("http://x/api/proxy/v1/a", { method: "POST", body: "{}" }), params(["v1", "a"]));
    expect(purge).not.toHaveBeenCalled();
  });

  it("does not purge for reads", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await GET(new Request("http://x/api/proxy/v1/a"), params(["v1", "a"]));
    expect(purge).not.toHaveBeenCalled();
  });

  it("does not purge for a read-only POST (search/preview/validate)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    for (const path of [["v1", "documents", "search"], ["v1", "analytics", "query"], ["v1", "assets", "leases", "preview"]]) {
      await POST(new Request("http://x/api/proxy/" + path.join("/"), { method: "POST", body: "{}" }), params(path));
    }
    expect(purge).not.toHaveBeenCalled();
  });

  it("does not purge on gateway-public routes, where a forged tid would go unverified", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(new Request("http://x/api/proxy/v1/crm/public/leads", { method: "POST", body: "{}" }), params(["v1", "crm", "public", "leads"]));
    await POST(new Request("http://x/api/proxy/v1/meetings/minutes/verify", { method: "POST", body: "{}" }), params(["v1", "meetings", "minutes", "verify"]));
    expect(purge).not.toHaveBeenCalled();
  });
});
