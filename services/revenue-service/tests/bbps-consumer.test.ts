/**
 * BBPS consumer integration tests.
 *
 * Verifies: fetchBill inserts transaction, payBill inserts receipt + DCB entry,
 * outbox events, idempotency.
 *
 * _Requirements: SVC-134, Requirement 15_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "receipt-bbps-1" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
const mockGetDcbOutstanding = vi.fn().mockResolvedValue({
  assesseeId: "assessee-1",
  ownerName: "Test Owner",
  totalOutstandingMinor: 500000n,
  oldestDueDate: "2024-06-30",
  demandCount: 2,
});

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) =>
      fn({ insert: mockInsert, select: vi.fn(), update: vi.fn() }),
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

vi.mock("../src/modules/bbps/schema.js", () => ({
  bbpsTransactions: Symbol("bbpsTransactions"),
}));

vi.mock("../src/modules/collection/schema.js", () => ({
  receipts: { id: "id" },
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: Symbol("dcbEntries"),
}));

vi.mock("../src/modules/bbps/domain.js", () => ({
  buildFetchBillResponse: vi.fn().mockReturnValue({
    customerName: "Test Owner",
    billAmount: "5000.00",
    billAmountMinor: 500000n,
    billDate: "2025-01-15",
    dueDate: "2024-06-30",
    billNumber: "BBPS-ASSESSEE",
  }),
  validateBbpsPayment: vi.fn(),
}));

vi.mock("../src/modules/bbps/repo.js", () => ({
  getDcbOutstanding: (...args: any[]) => mockGetDcbOutstanding(...args),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerBbpsConsumers } from "../src/modules/bbps/consumer.js";

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
    messageId: "msg-bbps-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: { assesseeIdentifier: "PROP-001" },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BBPS Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDcbOutstanding.mockResolvedValue({
      assesseeId: "assessee-1",
      ownerName: "Test Owner",
      totalOutstandingMinor: 500000n,
      oldestDueDate: "2024-06-30",
      demandCount: 2,
    });
    mockReturning.mockResolvedValue([{ id: "receipt-bbps-1" }]);

    const queue = createMockQueue();
    registerBbpsConsumers(queue);
  });

  describe("bbpsFetchBill", () => {
    it("inserts a bbps_transaction record", async () => {
      const msg = buildMsg();
      await handlers["revenue.bbps.fetch_bill"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 1 insert: bbps_transaction
      expect(mockInsert).toHaveBeenCalledTimes(1);
      // 1 enqueue: audit
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
      expect(mockEnqueue.mock.calls[0]![1].payload).toMatchObject({
        action: "fetch_bill",
        resourceType: "bbps_transaction",
      });
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.bbps.fetch_bill"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("bbpsPayBill", () => {
    it("inserts receipt + DCB entry + bbps_transaction and enqueues events", async () => {
      const msg = buildMsg({
        payload: {
          assesseeIdentifier: "PROP-001",
          amountMinor: "200000",
          bbpsTxnId: "BBPS-TXN-001",
          channel: "bbps",
        },
      });
      await handlers["revenue.bbps.pay_bill"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 3 inserts: receipt + DCB entry + bbps_transaction
      expect(mockInsert).toHaveBeenCalledTimes(3);
      // 2 enqueue: receiptCaptured + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.receipt.captured");
      expect(mockEnqueue.mock.calls[0]![1].payload).toMatchObject({
        receiptId: "receipt-bbps-1",
        assesseeId: "assessee-1",
        bbpsTxnId: "BBPS-TXN-001",
      });
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:dcb:assessee-1");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:receipts:assessee-1");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: {
          assesseeIdentifier: "PROP-001",
          amountMinor: "200000",
          bbpsTxnId: "BBPS-TXN-001",
          channel: "bbps",
        },
      });
      await handlers["revenue.bbps.pay_bill"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });
});
