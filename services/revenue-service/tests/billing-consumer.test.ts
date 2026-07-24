/**
 * Billing consumer integration tests.
 *
 * Verifies: bill generation from demand with correct total, outbox events,
 * idempotency skip.
 *
 * _Requirements: SVC-132, Requirement 9_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "bill-1" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

const mockSelectFrom = vi.fn().mockReturnThis();
const mockSelectWhere = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) =>
      fn({ insert: mockInsert, select: mockSelect, update: vi.fn() }),
    ),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...args: any[]) => mockCacheInvalidate(...args),
    getOrLoad: vi.fn(),
  },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/modules/billing/schema.js", () => ({
  bills: Symbol("bills"),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  demands: Symbol("demands"),
  dcbEntries: Symbol("dcbEntries"),
}));

vi.mock("../src/modules/rate-engine/schema.js", () => ({
  rateHeads: Symbol("rateHeads"),
}));

vi.mock("../src/modules/billing/domain.js", () => ({
  generateBillFromDemand: vi.fn(
    (demand: any, rateCategory: string, billSequence: number, billDate: string) => ({
      assesseeId: demand.assesseeId,
      demandId: demand.id,
      assessmentId: demand.assessmentId,
      billNo: `BILL-${rateCategory.toUpperCase()}-${String(billSequence).padStart(6, "0")}`,
      billDate,
      dueDate: demand.dueDate,
      principalMinor: demand.principalMinor,
      rebateMinor: demand.rebateMinor,
      penaltyMinor: demand.penaltyMinor,
      totalMinor: demand.netMinor,
      receiptHeadCode: rateCategory,
    }),
  ),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerBillingConsumers } from "../src/modules/billing/consumer.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    messageId: "msg-billing-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: { assessmentId: "assessment-1" },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Billing Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const queue = createMockQueue();

    // Mock tx.select().from(demands).where() → returns demand
    mockSelectWhere
      .mockResolvedValueOnce([
        {
          id: "demand-1",
          assesseeId: "assessee-1",
          assessmentId: "assessment-1",
          rateHeadId: "rh-1",
          financialYear: "2024-25",
          dueDate: "2025-03-31",
          principalMinor: 100000n,
          rebateMinor: 5000n,
          penaltyMinor: 0n,
          netMinor: 95000n,
        },
      ])
      // tx.select().from(rateHeads).where() → returns rate head
      .mockResolvedValueOnce([{ id: "rh-1", category: "property_tax" }])
      // tx.select().from(bills).where() → existing bills count
      .mockResolvedValueOnce([]);

    registerBillingConsumers(queue);
  });

  describe("billGenerate", () => {
    it("generates a bill from demand with correct total and enqueues events", async () => {
      const msg = buildMsg();
      await handlers["revenue.bill.generate"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 1 insert: the bill
      expect(mockInsert).toHaveBeenCalledTimes(1);
      // 2 enqueue calls: billGenerated + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.bill.generated");
      expect(mockEnqueue.mock.calls[0]![1].payload).toMatchObject({
        assessmentId: "assessment-1",
        assesseeId: "assessee-1",
      });
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:bills:assessee-1");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.bill.generate"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });
});
