/**
 * Collection consumer integration tests.
 *
 * Verifies: receipt insert + DCB entry, refundDecide maker-checker,
 * adjustment creates 2 DCB entries, idempotency.
 *
 * _Requirements: SVC-133, SVC-135, Requirement 11_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "receipt-1" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

const mockSelectFrom = vi.fn().mockReturnThis();
const mockSelectWhere = vi.fn().mockReturnThis();
const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });

const mockSet = vi.fn().mockReturnThis();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
const mockGetDemandBalance = vi.fn().mockResolvedValue(500000n);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) =>
      fn({ insert: mockInsert, select: mockSelect, update: mockUpdate }),
    ),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ assesseeId: "assessee-1" }]),
        }),
      }),
    }),
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

vi.mock("../src/modules/collection/schema.js", () => ({
  receipts: { tenantId: "tenantId", id: "id", assesseeId: "assesseeId", reference: "reference" },
  refunds: { tenantId: "tenantId", id: "id", assesseeId: "assesseeId", makerUserId: "makerUserId" },
  adjustments: Symbol("adjustments"),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: { tenantId: "tenantId", assesseeId: "assesseeId", demandId: "demandId" },
}));

vi.mock("../src/modules/collection/domain.js", () => ({
  validateReceipt: vi.fn(),
  validateRefund: vi.fn(),
  validateAdjustment: vi.fn(),
  assertMakerChecker: (maker: string, checker: string) => {
    if (maker === checker) {
      const err = new Error("MAKER_CHECKER_VIOLATION");
      (err as any).code = "MAKER_CHECKER_VIOLATION";
      throw err;
    }
  },
}));

vi.mock("../src/modules/collection/repo.js", () => ({
  getDemandBalance: (...args: any[]) => mockGetDemandBalance(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn(),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";

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
    messageId: "msg-collection-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: {
      assesseeId: "assessee-1",
      demandId: "demand-1",
      amountMinor: "100000",
      channel: "counter",
      reference: "REF-001",
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Collection Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDemandBalance.mockResolvedValue(500000n);
    const queue = createMockQueue();
    registerCollectionConsumers(queue);
  });

  describe("receiptCreate", () => {
    it("inserts receipt + DCB entry and enqueues events", async () => {
      const msg = buildMsg();
      await handlers["revenue.receipt.create"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 2 inserts: receipt + DCB entry
      expect(mockInsert).toHaveBeenCalledTimes(2);
      // 2 enqueue: receiptCaptured + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.receipt.captured");
      expect(mockEnqueue.mock.calls[0]![1].payload).toMatchObject({
        receiptId: "receipt-1",
        assesseeId: "assessee-1",
        demandId: "demand-1",
      });
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:receipts:assessee-1");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:dcb:assessee-1");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.receipt.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("refundDecide", () => {
    it("throws on maker-checker violation (same user as maker)", async () => {
      // Return a refund with makerUserId = actor-1
      mockSelectLimit.mockResolvedValueOnce([{
        id: "refund-1",
        makerUserId: "actor-1",
        assesseeId: "assessee-1",
        amountMinor: 50000n,
        reason: "Overpayment",
      }]);

      const msg = buildMsg({
        payload: { refundId: "refund-1", approve: true },
        actorId: "actor-1", // same as maker
      });

      await expect(handlers["revenue.refund.decide"]!(msg)).rejects.toThrow(
        "MAKER_CHECKER_VIOLATION",
      );
    });

    it("skips processing on duplicate messageId", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { refundId: "refund-1", approve: true },
      });
      await handlers["revenue.refund.decide"]!(msg);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("adjustmentCreate", () => {
    it("creates 2 DCB entries (debit source + credit target)", async () => {
      mockGetDemandBalance
        .mockResolvedValueOnce(200000n) // fromDemand balance
        .mockResolvedValueOnce(100000n); // toDemand balance

      const msg = buildMsg({
        payload: {
          assesseeId: "assessee-1",
          fromDemandId: "demand-from",
          toDemandId: "demand-to",
          amountMinor: "50000",
          reason: "Reassignment",
        },
      });

      await handlers["revenue.adjustment.create"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 3 inserts: adjustment + 2 DCB entries
      expect(mockInsert).toHaveBeenCalledTimes(3);
      // 2 enqueue: adjustmentApplied + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.adjustment.applied");
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: {
          assesseeId: "assessee-1",
          fromDemandId: "demand-from",
          toDemandId: "demand-to",
          amountMinor: "50000",
          reason: "Reassignment",
        },
      });
      await handlers["revenue.adjustment.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });
});
