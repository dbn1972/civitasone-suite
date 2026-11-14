import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishGlobalSearchRecord, publishGlobalSearchRemoval } from "../src/global/index.js";

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock("@civitasone/outbox", () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tx = {} as Parameters<typeof publishGlobalSearchRecord>[0];
const ctx = { actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", correlationId: "c-1" };
const rec = { entityType: "finance.vendor" as const, entityId: E1, tenantId: T1, title: "Acme Traders", refNumber: "V-001", status: "active" };

describe("publishGlobalSearchRecord", () => {
  const saved = { ...process.env };
  beforeEach(() => { mockEnqueue.mockClear(); delete process.env.GLOBAL_SEARCH_TENANTS; delete process.env.GLOBAL_SEARCH_DISABLED; });
  afterEach(() => { process.env = { ...saved }; });

  it("flag off: nothing is published (outbox untouched)", async () => {
    expect(await publishGlobalSearchRecord(tx, rec, ctx)).toBe(false);
    expect(await publishGlobalSearchRemoval(tx, rec, ctx)).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
  it("flag on for another tenant: still nothing for this tenant", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T2;
    expect(await publishGlobalSearchRecord(tx, rec, ctx)).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
  it("flag on: one upsert event on the existing topic carrying entityType and only contract fields", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T1;
    expect(await publishGlobalSearchRecord(tx, rec, ctx)).toBe(true);
    const [, env] = mockEnqueue.mock.calls[0]!;
    expect(env.topic).toBe("search.index.update");
    expect(env.tenantId).toBe(T1);
    expect(env.payload).toEqual({
      id: E1, tenantId: T1, module: "finance", name: "Acme Traders", refNumber: "V-001", description: null, status: "active",
      action: "upsert", entityType: "finance.vendor",
    });
  });
  it("flag on: delete event", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T1;
    await publishGlobalSearchRemoval(tx, rec, ctx);
    const [, env] = mockEnqueue.mock.calls[0]!;
    expect(env.payload).toMatchObject({ id: E1, action: "delete", entityType: "finance.vendor", status: "deleted" });
  });
  it("scrubs personal data before it reaches the outbox", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T1;
    await publishGlobalSearchRecord(tx, { ...rec, title: "Acme ABCDE1234F", summary: "call 9876543210" }, ctx);
    const [, env] = mockEnqueue.mock.calls[0]!;
    expect(JSON.stringify(env.payload)).not.toMatch(/ABCDE1234F|9876543210/);
  });
});
