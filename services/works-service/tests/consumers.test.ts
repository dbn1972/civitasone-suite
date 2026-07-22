/**
 * Consumer idempotency tests.
 * Tests that replaying the same messageId is a no-op.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and outbox
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
const mockTx = {
  insert: mockInsert,
  update: mockUpdate,
  select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
};
const mockTransaction = vi.fn((fn: Function) => fn(mockTx));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: Function) => fn(mockTx)),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: Function) => fn()), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

let markProcessedResult = true;
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(markProcessedResult)),
  enqueue: vi.fn().mockResolvedValue(undefined),
  outboxMessages: {},
  processed: {},
  outboxSchema: {},
}));

const baseMsg = {
  messageId: "msg-001",
  type: "works.proposal.create",
  tenantId: "t-1",
  actorId: "a-1",
  correlationId: "corr-1",
  schemaVersion: "1.0",
};

describe("Proposal consumer — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedResult = true;
  });

  it("processes a new message (markProcessed returns true)", async () => {
    const { registerProposalConsumers } = await import("../src/modules/proposal/consumer.js");
    const handlers: Record<string, Function> = {};
    const q = { subscribe: (topic: string, handler: Function) => { handlers[topic] = handler; } } as any;
    registerProposalConsumers(q);

    const handler = handlers["works.proposal.create"];
    expect(handler).toBeDefined();

    await handler({
      ...baseMsg,
      payload: {
        id: "p-001",
        category: "regular",
        description: "Test work",
        workTypeId: "wt-1",
        estimatedCostMinor: "1000000",
      },
    });

    const { markProcessed } = await import("../src/shared/outbox.js");
    expect(markProcessed).toHaveBeenCalledWith(mockTx, "msg-001");
    expect(mockInsert).toHaveBeenCalled();
  });

  it("skips duplicate message (markProcessed returns false)", async () => {
    markProcessedResult = false;
    const { registerProposalConsumers } = await import("../src/modules/proposal/consumer.js");
    const handlers: Record<string, Function> = {};
    const q = { subscribe: (topic: string, handler: Function) => { handlers[topic] = handler; } } as any;
    registerProposalConsumers(q);

    const handler = handlers["works.proposal.create"];
    mockInsert.mockClear();

    await handler({
      ...baseMsg,
      messageId: "msg-duplicate",
      payload: {
        id: "p-002", category: "deposit", description: "Dup",
        workTypeId: "wt-1", estimatedCostMinor: "500",
      },
    });

    // insert should NOT have been called because markProcessed returned false
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("Approval consumer — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedResult = true;
  });

  it("processes AA finalize message", async () => {
    const { registerApprovalConsumers } = await import("../src/modules/approval/consumer.js");
    const handlers: Record<string, Function> = {};
    const q = { subscribe: (topic: string, handler: Function) => { handlers[topic] = handler; } } as any;
    registerApprovalConsumers(q);

    const handler = handlers["works.aa.finalize"];
    expect(handler).toBeDefined();

    await handler({
      ...baseMsg,
      type: "works.aa.finalize",
      payload: { id: "aa-001" },
    });

    const { markProcessed } = await import("../src/shared/outbox.js");
    expect(markProcessed).toHaveBeenCalledWith(mockTx, "msg-001");
  });

  it("skips duplicate AA finalize (idempotent)", async () => {
    markProcessedResult = false;
    const { registerApprovalConsumers } = await import("../src/modules/approval/consumer.js");
    const handlers: Record<string, Function> = {};
    const q = { subscribe: (topic: string, handler: Function) => { handlers[topic] = handler; } } as any;
    registerApprovalConsumers(q);

    const handler = handlers["works.aa.finalize"];
    mockUpdate.mockClear();

    await handler({
      ...baseMsg,
      messageId: "msg-dup-aa",
      type: "works.aa.finalize",
      payload: { id: "aa-002" },
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("Billing consumer — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedResult = true;
  });

  it("processes bill create message", async () => {
    const { registerBillingConsumers } = await import("../src/modules/billing/consumer.js");
    const handlers: Record<string, Function> = {};
    const q = { subscribe: (topic: string, handler: Function) => { handlers[topic] = handler; } } as any;
    registerBillingConsumers(q);

    const handler = handlers["works.bill.create"];
    expect(handler).toBeDefined();

    await handler({
      ...baseMsg,
      type: "works.bill.create",
      payload: {
        id: "bill-001",
        workId: "w-1",
        awardId: "award-1",
        billMode: "e_mb",
        billNumber: "BILL/001",
        grossAmountMinor: "1000000",
        deductionsMinor: "50000",
      },
    });

    const { markProcessed } = await import("../src/shared/outbox.js");
    expect(markProcessed).toHaveBeenCalledWith(mockTx, "msg-001");
    expect(mockInsert).toHaveBeenCalled();
  });

  it("skips duplicate bill create (idempotent)", async () => {
    markProcessedResult = false;
    const { registerBillingConsumers } = await import("../src/modules/billing/consumer.js");
    const handlers: Record<string, Function> = {};
    const q = { subscribe: (topic: string, handler: Function) => { handlers[topic] = handler; } } as any;
    registerBillingConsumers(q);

    const handler = handlers["works.bill.create"];
    mockInsert.mockClear();

    await handler({
      ...baseMsg,
      messageId: "msg-dup-bill",
      type: "works.bill.create",
      payload: {
        id: "bill-002", workId: "w-1", awardId: "award-1",
        billMode: "abstract", billNumber: "B2", grossAmountMinor: "100",
      },
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
