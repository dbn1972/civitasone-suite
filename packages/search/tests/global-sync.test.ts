import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncGlobalRecord } from "../src/global/index.js";

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock("@civitasone/outbox", () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tx = {} as never;
const row = { tenantId: A, updatedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Acme", no: "V-1", status: "active" };
const toRecord = (r: typeof row) => ({ title: r.name, refNumber: r.no, status: r.status });

describe("syncGlobalRecord", () => {
  const saved = { ...process.env };
  beforeEach(() => { mockEnqueue.mockClear(); delete process.env.GLOBAL_SEARCH_TENANTS; delete process.env.GLOBAL_SEARCH_DISABLED; });
  afterEach(() => { process.env = { ...saved }; });

  it("flag off: no query, no outbox write (tenant known)", async () => {
    const load = vi.fn().mockResolvedValue(row);
    await syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, tenantId: A, load, toRecord });
    expect(load).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
  it("flag off for every tenant: no query even when the tenant is unknown at the call site", async () => {
    const load = vi.fn().mockResolvedValue(row);
    await syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, load, toRecord });
    expect(load).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
  it("some other tenant on: this tenant's row is read but nothing is published", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = B;
    const load = vi.fn().mockResolvedValue(row);
    await syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, load, toRecord });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
  it("flag on: upserts the re-read row with the row's actor", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    await syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, tenantId: A, load: async () => row, toRecord });
    const [, env] = mockEnqueue.mock.calls[0]!;
    expect(env.actorId).toBe(row.updatedBy);
    expect(env.payload).toMatchObject({ id: E, tenantId: A, module: "finance", entityType: "finance.vendor", name: "Acme", refNumber: "V-1", status: "active", action: "upsert" });
  });
  it("row gone, or mapped to null: publishes a delete", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    await syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, tenantId: A, load: async () => null, toRecord });
    await syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, tenantId: A, load: async () => row, toRecord: () => null });
    expect(mockEnqueue.mock.calls.map((c) => c[1].payload.action)).toEqual(["delete", "delete"]);
  });
  it("a contract error is swallowed (search never aborts the business transaction); other errors propagate", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    await expect(syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, tenantId: A, load: async () => row, toRecord: () => ({ title: "", status: "x" }) })).resolves.toBeUndefined();
    expect(mockEnqueue).not.toHaveBeenCalled();
    mockEnqueue.mockRejectedValueOnce(new Error("db down"));
    await expect(syncGlobalRecord({ tx, entityType: "finance.vendor", entityId: E, tenantId: A, load: async () => row, toRecord })).rejects.toThrow("db down");
  });
});
