/**
 * GAP-CRM-ESCALATION-RULES-01 -- the server-side tenant directory the escalation
 * editor's pickers and recipient validation are built on. Unit-level: fetch is
 * stubbed. Every failure mode must come back as `undefined` (unverifiable ->
 * callers fail closed), never as an empty list that reads as "there are none".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listTenantRoleNames, listActiveTenantUsers } from "../src/shared/directory-client.js";

const TENANT = "11111111-2222-4333-8444-555555555555";
const fetchMock = vi.fn();
const savedSecret = process.env.INTERNAL_SERVICE_SECRET;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const user = (n: number, status = "active") => ({ id: `u-${n}`, name: `User ${n}`, status, email: `u${n}@example.gov.in` });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = savedSecret;
});

describe("listTenantRoleNames", () => {
  it("returns the names of ACTIVE roles only, asking policy-service as the caller's tenant over the internal path", async () => {
    fetchMock.mockResolvedValue(json([
      { id: "r1", name: "sales_manager", status: "active" },
      { id: "r2", name: "retired_role", status: "inactive" },
      { id: "r3", name: "lead_desk", status: "active" },
    ]));
    expect(await listTenantRoleNames(TENANT)).toEqual(["sales_manager", "lead_desk"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toMatch(/\/policy\/roles$/);
    expect(init.headers["x-internal"]).toBe("1");
    expect(init.headers["x-tenant-id"]).toBe(TENANT);
    expect(init.headers["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
  });

  it("tolerates a { data: [...] } wrapper", async () => {
    fetchMock.mockResolvedValue(json({ data: [{ name: "lead_desk", status: "active" }] }));
    expect(await listTenantRoleNames(TENANT)).toEqual(["lead_desk"]);
  });

  it("returns an empty list (not undefined) when the tenant genuinely has no roles", async () => {
    fetchMock.mockResolvedValue(json([]));
    expect(await listTenantRoleNames(TENANT)).toEqual([]);
  });

  it.each([
    ["a 403", () => fetchMock.mockResolvedValue(json({}, 403))],
    ["a 500", () => fetchMock.mockResolvedValue(json({}, 500))],
    ["an unexpected body", () => fetchMock.mockResolvedValue(json({ nope: true }))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
  ])("is undefined (unverifiable) on %s", async (_label, arrange) => {
    arrange();
    expect(await listTenantRoleNames(TENANT)).toBeUndefined();
  });
});

describe("listActiveTenantUsers", () => {
  it("returns ACTIVE users as id + display name only (no email), and is not truncated on a short page", async () => {
    fetchMock.mockResolvedValue(json([user(1), user(2, "suspended"), user(3)]));
    const got = await listActiveTenantUsers(TENANT);
    expect(got).toEqual({ users: [{ id: "u-1", name: "User 1" }, { id: "u-3", name: "User 3" }], truncated: false });
    expect(JSON.stringify(got)).not.toContain("example.gov.in");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toMatch(/\/identity\/users\?limit=200&offset=0$/);
    expect(init.headers["x-tenant-id"]).toBe(TENANT);
  });

  it("falls back to the id when a user has no display name", async () => {
    fetchMock.mockResolvedValue(json([{ id: "u-9", name: "  ", status: "active" }]));
    expect((await listActiveTenantUsers(TENANT))?.users).toEqual([{ id: "u-9", name: "u-9" }]);
  });

  it("pages through full pages and reports truncation when the cap is hit", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => user(i));
    fetchMock.mockImplementation(async () => json(fullPage));
    const got = await listActiveTenantUsers(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(got?.truncated).toBe(true);
    expect(got?.users.length).toBe(1000);
    const offsets = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get("offset"));
    expect(offsets).toEqual(["0", "200", "400", "600", "800"]);
  });

  it("stops at the first short page", async () => {
    fetchMock
      .mockResolvedValueOnce(json(Array.from({ length: 200 }, (_, i) => user(i))))
      .mockResolvedValueOnce(json([user(500)]));
    const got = await listActiveTenantUsers(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(got?.truncated).toBe(false);
    expect(got?.users.length).toBe(201);
  });

  it.each([
    ["a 403", () => fetchMock.mockResolvedValue(json({}, 403))],
    ["an unexpected body", () => fetchMock.mockResolvedValue(json("nope"))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("timeout"))],
  ])("is undefined (unverifiable) on %s, even part-way through paging", async (_label, arrange) => {
    arrange();
    expect(await listActiveTenantUsers(TENANT)).toBeUndefined();
  });

  it("is undefined if a later page fails after an earlier one succeeded", async () => {
    fetchMock
      .mockResolvedValueOnce(json(Array.from({ length: 200 }, (_, i) => user(i))))
      .mockResolvedValueOnce(json({}, 500));
    expect(await listActiveTenantUsers(TENANT)).toBeUndefined();
  });
});
