/**
 * Masters CQRS tests (CRITICAL bug fix).
 *
 * masters/routes.ts used to publish master-create commands to
 * COMMANDS.proposalCreate — every master row was silently persisted into
 * work_proposals instead of its own table. These tests assert:
 *   1. publishMasterCreate publishes to COMMANDS.masterCreate, NEVER proposalCreate.
 *   2. The masters consumer resolves masterType -> table via the registry and
 *      inserts into the CORRECT table (not work_proposals).
 *   3. Money fields (rate/cost) are decoded via parseMinor before insert.
 *   4. Idempotency + unknown-masterType rejection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockInvalidateResource = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: mockPublish, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
  cache: {
    getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()),
    invalidate: vi.fn(),
    invalidateResource: mockInvalidateResource,
  },
}));

const mockInserted: unknown[] = [];
const mockInsertedValues: unknown[] = [];
let mockMarkResult = true;
const mockTx: any = {
  insert: (t: unknown) => {
    mockInserted.push(t);
    return {
      values: (v: unknown) => {
        mockInsertedValues.push(v);
        return Promise.resolve();
      },
    };
  },
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

const mockEnqueued: Array<{ topic: string }> = [];
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
  enqueue: vi.fn((_tx: unknown, ev: { topic: string }) => { mockEnqueued.push(ev); return Promise.resolve(); }),
  outboxMessages: {},
  processed: {},
  outboxSchema: {},
}));

const baseCtx = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  correlationId: "corr-1",
  roles: [],
  sessionId: "s-1",
  actorType: "user",
} as any;

beforeEach(() => {
  mockPublish.mockClear();
  mockInvalidateResource.mockClear();
  mockInserted.length = 0;
  mockInsertedValues.length = 0;
  mockEnqueued.length = 0;
  mockMarkResult = true;
});

describe("Masters CQRS — publishMasterCreate", () => {
  it("publishes to COMMANDS.masterCreate, NOT COMMANDS.proposalCreate", async () => {
    const { publishMasterCreate } = await import("../src/modules/masters/commands.js");
    const { COMMANDS } = await import("../src/topics.js");

    await publishMasterCreate(baseCtx, "authorities", { name: "Test Authority", code: "TA01" });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.masterCreate);
    expect(topic).not.toBe(COMMANDS.proposalCreate);
    expect(msg.type).toBe(COMMANDS.masterCreate);
    expect(msg.type).not.toBe(COMMANDS.proposalCreate);
    expect(msg.payload.masterType).toBe("authorities");
    expect(msg.payload.name).toBe("Test Authority");
  });

  it("returns an accepted envelope with a generated id", async () => {
    const { publishMasterCreate } = await import("../src/modules/masters/commands.js");
    const result = await publishMasterCreate(baseCtx, "programs", { name: "Program A" });
    expect(result.status).toBe("accepted");
    expect(result.id).toBeTruthy();
    expect(result.correlationId).toBe("corr-1");
  });
});

describe("Masters CQRS — consumer persistence", () => {
  it("masterCreate for 'authorities' inserts into the authorities table (not work_proposals)", async () => {
    const { registerMasterConsumers } = await import("../src/modules/masters/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const { authorities } = await import("../src/modules/masters/schema.js");
    const { workProposals } = await import("../src/modules/proposal/schema.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerMasterConsumers(q);

    await handlers[COMMANDS.masterCreate]({
      messageId: "m-1", tenantId: baseCtx.tenantId, actorId: baseCtx.actorId,
      correlationId: "c-1", schemaVersion: "1.0",
      payload: { id: "auth-1", masterType: "authorities", name: "Test Authority", code: "TA01" },
    });

    expect(mockInserted).toHaveLength(1);
    expect(mockInserted[0]).toBe(authorities);
    expect(mockInserted[0]).not.toBe(workProposals);
    expect(mockEnqueued.some((e) => e.topic === EVENTS.masterCreated)).toBe(true);
    expect(mockInvalidateResource).toHaveBeenCalledWith(baseCtx.tenantId, "master:authorities");
  });

  it("masterCreate for 'sr-items' inserts into the sr_items table and decodes rate to a bigint", async () => {
    const { registerMasterConsumers } = await import("../src/modules/masters/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const { srItems } = await import("../src/modules/masters/schema.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerMasterConsumers(q);

    await handlers[COMMANDS.masterCreate]({
      messageId: "m-2", tenantId: baseCtx.tenantId, actorId: baseCtx.actorId,
      correlationId: "c-1", schemaVersion: "1.0",
      payload: {
        id: "sr-1", masterType: "sr-items", zone: "N", srYear: "2026",
        itemCode: "IT-1", description: "desc", unit: "cum", rate: "900700000000000001",
      },
    });

    expect(mockInserted[0]).toBe(srItems);
    const inserted = mockInsertedValues[0] as Record<string, unknown>;
    expect(inserted.rate).toBe(900700000000000001n);
  });

  it("masterCreate for 'assets' decodes cost to a bigint when present", async () => {
    const { registerMasterConsumers } = await import("../src/modules/masters/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const { assets } = await import("../src/modules/masters/schema.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerMasterConsumers(q);

    await handlers[COMMANDS.masterCreate]({
      messageId: "m-3", tenantId: baseCtx.tenantId, actorId: baseCtx.actorId,
      correlationId: "c-1", schemaVersion: "1.0",
      payload: { id: "asset-1", masterType: "assets", code: "A1", name: "Bridge", cost: 500000 },
    });

    expect(mockInserted[0]).toBe(assets);
    const inserted = mockInsertedValues[0] as Record<string, unknown>;
    expect(inserted.cost).toBe(500000n);
  });

  it("rejects an unknown masterType (no insert, no event)", async () => {
    const { registerMasterConsumers } = await import("../src/modules/masters/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerMasterConsumers(q);

    await handlers[COMMANDS.masterCreate]({
      messageId: "m-4", tenantId: baseCtx.tenantId, actorId: baseCtx.actorId,
      correlationId: "c-1", schemaVersion: "1.0",
      payload: { id: "x-1", masterType: "not-a-real-master", name: "X" },
    });

    expect(mockInserted).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });

  it("is idempotent on redelivery (markProcessed returns false)", async () => {
    mockMarkResult = false;
    const { registerMasterConsumers } = await import("../src/modules/masters/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerMasterConsumers(q);

    await handlers[COMMANDS.masterCreate]({
      messageId: "m-dup", tenantId: baseCtx.tenantId, actorId: baseCtx.actorId,
      correlationId: "c-1", schemaVersion: "1.0",
      payload: { id: "auth-2", masterType: "authorities", name: "Dup", code: "D1" },
    });

    expect(mockInserted).toHaveLength(0);
  });

  it("does NOT subscribe to COMMANDS.proposalCreate (masters consumer is isolated from the proposal topic)", async () => {
    const { registerMasterConsumers } = await import("../src/modules/masters/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerMasterConsumers(q);

    expect(handlers[COMMANDS.proposalCreate]).toBeUndefined();
    expect(handlers[COMMANDS.masterCreate]).toBeDefined();
  });
});
