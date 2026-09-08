/**
 * BBPS consumer integration tests.
 *
 * Verifies: fetchBill inserts transaction, payBill inserts receipt + DCB entry,
 * outbox events, idempotency (per-messageId, via markProcessed), and SEC-001
 * replay/duplicate protection (per-bbpsTxnId, via the tenant-scoped unique
 * constraint added in migrations/0006_bbps_replay_protection.sql and claimed
 * here with an atomic ON CONFLICT DO NOTHING + RETURNING insert).
 *
 * _Requirements: SVC-134, Requirement 15_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// insert() dispatches on the shape of the values payload rather than the
// table reference (both bbpsTransactions inserts — fetchBill's "pending" row
// and payBill's replay-protection claim — share the same mocked table
// symbol), mirroring what the real chain looks like for each call site:
//   - dcbEntries insert:                     values(v) -> awaited directly
//   - receipts insert:                       values(v).returning(...)
//   - fetchBill's bbps_transactions insert:   values(v) -> awaited directly
//   - payBill's bbps_transactions claim:      values(v).onConflictDoNothing(...).returning(...)

const mockBbpsClaimReturning = vi.fn();
const mockReceiptReturning = vi.fn();

const mockInsert = vi.fn((_table: any) => ({
  values: (v: any) => {
    if (v && "entryType" in v) {
      // dcbEntries — no further chain call, awaited directly.
      return Promise.resolve(undefined);
    }
    if (v && "reference" in v) {
      // receipts
      return { returning: mockReceiptReturning };
    }
    if (v && v.status === "pending") {
      // fetchBill's bbps_transactions pending-row insert — awaited directly.
      return Promise.resolve(undefined);
    }
    // payBill's bbps_transactions replay-protection claim (status: "success")
    return { onConflictDoNothing: () => ({ returning: mockBbpsClaimReturning }) };
  },
}));

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn(() => ({ set: () => ({ where: mockUpdateWhere }) }));

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
      fn({ insert: mockInsert, select: vi.fn(), update: mockUpdate }),
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
  bbpsTransactions: { id: "id", tenantId: "tenant_id", bbpsTxnId: "bbps_txn_id" },
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
    mockMarkProcessed.mockResolvedValue(true);
    mockReceiptReturning.mockResolvedValue([{ id: "receipt-bbps-1" }]);
    // Default: this bbpsTxnId has not been seen before — the claim succeeds.
    mockBbpsClaimReturning.mockResolvedValue([{ id: "bbps-txn-1" }]);

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
    it("claims the bbps_transaction row, inserts receipt + DCB entry, attaches the receipt, and enqueues events", async () => {
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
      // 3 inserts: bbps_transaction claim + receipt + DCB entry
      expect(mockInsert).toHaveBeenCalledTimes(3);
      expect(mockBbpsClaimReturning).toHaveBeenCalledTimes(1);
      expect(mockReceiptReturning).toHaveBeenCalledTimes(1);
      // receiptId gets attached back onto the claimed bbps_transaction row
      expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
      // 2 enqueue: receiptCaptured + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.receipt.captured");
      expect(mockEnqueue.mock.calls[0]![1].payload).toMatchObject({
        receiptId: "receipt-bbps-1",
        assesseeId: "assessee-1",
        bbpsTxnId: "BBPS-TXN-001",
      });
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");
      expect(mockEnqueue.mock.calls[1]![1].payload).toMatchObject({ outcome: "success" });

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

    // ── SEC-001 replay/duplicate protection ─────────────────────────────────
    //
    // A replayed pay-bill request (same bbpsTxnId, but a FRESH messageId —
    // markProcessed alone does not catch this, see consumer.ts's SEC-001
    // comment) must not write a second receipt/DCB entry/GL event. The claim
    // insert's ON CONFLICT DO NOTHING returns no row when the (tenant_id,
    // bbps_txn_id) unique constraint already has a matching row — simulated
    // here by mockBbpsClaimReturning resolving to [].

    it("SEC-001: a replayed bbpsTxnId (different messageId, claim returns no row) writes no receipt/DCB entry/GL event", async () => {
      mockBbpsClaimReturning.mockResolvedValueOnce([]);
      const msg = buildMsg({
        messageId: "msg-bbps-002-a-replay-of-001s-payload",
        payload: {
          assesseeIdentifier: "PROP-001",
          amountMinor: "200000",
          bbpsTxnId: "BBPS-TXN-001", // same bbpsTxnId as the success-path test above
          channel: "bbps",
        },
      });
      await handlers["revenue.bbps.pay_bill"]!(msg);

      // markProcessed passes (this IS a new messageId) but the app-level
      // bbpsTxnId claim fails, so nothing further is written.
      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1); // only the (rejected) claim attempt
      expect(mockReceiptReturning).not.toHaveBeenCalled(); // no second receipt
      expect(mockUpdateWhere).not.toHaveBeenCalled();

      // Exactly one enqueue: a "rejected_duplicate" audit event, and
      // specifically NOT a second revenue.receipt.captured (the GL-bound
      // event a replay must not be able to trigger twice).
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
      expect(mockEnqueue.mock.calls[0]![1].payload).toMatchObject({
        action: "pay_bill",
        resourceType: "bbps_transaction",
        outcome: "rejected_duplicate",
      });
      expect(mockEnqueue.mock.calls.some((c) => c[1].topic === "revenue.receipt.captured")).toBe(false);
    });
  });
});
