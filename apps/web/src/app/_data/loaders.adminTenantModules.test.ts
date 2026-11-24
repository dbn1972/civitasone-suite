import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));

import { getAdminTenantModules } from "./loaders";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}
const stub = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, body)));

const ID = "11111111-aaaa-4000-8000-000000000001";

describe("getAdminTenantModules", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("flattens the backend modules MAP into rows", async () => {
    stub(200, { tenantId: ID, edition: "pro", modules: { finance: true, hr_payroll: false }, featureFlags: {} });
    const r = await getAdminTenantModules(ID);
    expect(r.data).toEqual([
      { module: "Finance", enabled: "Yes", users: null, lastActivity: "—", usage: "—" },
      { module: "Hr Payroll", enabled: "No", users: null, lastActivity: "—", usage: "—" },
    ]);
  });

  it("an empty modules map yields no rows", async () => {
    stub(200, { tenantId: ID, edition: "pro", modules: {}, featureFlags: {} });
    expect((await getAdminTenantModules(ID)).data).toEqual([]);
  });

  it("still accepts an array-shaped payload", async () => {
    stub(200, { modules: [{ module: "Finance", enabled: true, users: 4 }] });
    const r = await getAdminTenantModules(ID);
    expect(r.data[0]).toMatchObject({ module: "Finance", enabled: "Yes", users: 4 });
  });

  it("404 (no edition row) -> error result with empty data and status 404", async () => {
    stub(404, { error: { code: "NOT_FOUND" } });
    const r = await getAdminTenantModules(ID);
    expect(r.data).toEqual([]);
    expect(r.source).toBe("error");
    expect(r.status).toBe(404);
  });
});
