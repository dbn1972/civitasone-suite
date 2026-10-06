/**
 * GAP-REVENUE-RECEIPTS-01 — the receiptCreate consumer must be idempotent on
 * the UTR / reference: a retry carrying the same (tenant, reference) must NOT
 * write a second receipt / DCB entry / GL event (no double credit).
 *
 * Mock-based, mirroring collection-consumer.test.ts. The receipts select
 * returns an existing row to simulate the UTR already being recorded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "receipt-1" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

// The dedup select: returns [] by default (no existing), overridden per test.
const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
const mockGetDemandBalance = vi.fn().mockResolvedValue(500000n);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn({ insert: mockInsert, select: mockSelect })),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => mockCacheInvalidate(...args), getOrLoad: vi.fn() },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/modules/collection/schema.js", () => ({
  receipts: { tenantId: "tenantId", id: "id", assesseeId: "assesseeId", reference: "reference" },
  refunds: { tenantId: "tenantId", id: "id" },
  adjustments: Symbol("adjustments"),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: { tenantId: "tenantId", assesseeId: "assesseeId", demandId: "demandId" },
}));

vi.mock("../src/modules/collection/domain.js", () => ({
  validateReceipt: vi.fn(),
  validateRefund: vi.fn(),
  validateAdjustment: vi.fn(),
  assertMakerChecker: vi.fn(),
}));

vi.mock("../src/modules/collection/repo.js", () => ({
  getDemandBalanceTx: (...args: any[]) => mockGetDemandBalance(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn(),
}));

import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";

type SubscribeHandler = (msg: any) => Promise<void>;
const handlers: Record<string, SubscribeHandler> = {};
function createMockQueue() {
  return {
    subscribe: vi.fn((topic: string, handler: SubscribeHandler) => {
      handlers[topic] = handler;
    }),
    publish: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as any;
}
function buildMsg(overrides: Partial<any> = {}) {
  return {
    messageId: "msg-1",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    payload: {
      assesseeId: "assessee-1",
      demandId: "demand-1",
      amountMinor: "100000",
      channel: "counter",
      reference: "UTR-DUP-1",
    },
    ...overrides,
  };
}

describe("receiptCreate idempotency (GAP-REVENUE-RECEIPTS-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDemandBalance.mockResolvedValue(500000n);
    mockSelectLimit.mockResolvedValue([]);
    const queue = createMockQueue();
    registerCollectionConsumers(queue);
  });

  it("records the receipt the first time (reference not yet seen)", async () => {
    mockSelectLimit.mockResolvedValue([]); // no existing receipt for this UTR
    await handlers["revenue.receipt.create"]!(buildMsg());

    // Receipt + DCB inserts happen; events enqueued.
    expect(mockInsert).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("no-ops a retry with the same UTR — no second receipt/DCB/GL event (no double credit)", async () => {
    // The dedup select finds an existing receipt for this (tenant, reference).
    mockSelectLimit.mockResolvedValue([{ id: "receipt-1" }]);

    await handlers["revenue.receipt.create"]!(buildMsg({ messageId: "msg-2-retry" }));

    // markProcessed ran (fresh messageId), but the handler returned early:
    expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
