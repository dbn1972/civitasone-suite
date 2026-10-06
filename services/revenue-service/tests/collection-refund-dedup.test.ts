/**
 * GAP-REVENUE-REFUNDS-02 — a receipt may have at most one live (non-rejected)
 * refund. The refundCreate consumer must no-op a second raise against a receipt
 * that already has a pending/approved/processed refund (no duplicate money-out).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

// receipts select: .from().where().limit(1) -> [receipt]
const mockReceiptLimit = vi.fn().mockResolvedValue([
  { id: "receipt-1", tenantId: "tenant-1", assesseeId: "assessee-1", amountMinor: 100000n },
]);
const mockReceiptWhere = vi.fn().mockReturnValue({ limit: mockReceiptLimit });
// refunds dedup select: .from().where() -> array of existing refunds
const mockRefundWhere = vi.fn().mockResolvedValue([]);

// select() is called twice in refundCreate: 1st = receipts (needs .limit),
// 2nd = refunds dedup (.where resolves to an array). Route by call order.
let selectCall = 0;
const mockSelect = vi.fn().mockImplementation(() => {
  selectCall += 1;
  if (selectCall === 1) return { from: () => ({ where: mockReceiptWhere }) };
  return { from: () => ({ where: mockRefundWhere }) };
});

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: any) => fn({ insert: mockInsert, select: mockSelect, update: vi.fn() })) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: any[]) => mockMarkProcessed(...a),
  enqueue: (...a: any[]) => mockEnqueue(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn().mockResolvedValue(undefined), getOrLoad: vi.fn() },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/modules/collection/schema.js", () => ({
  receipts: { tenantId: "tenantId", id: "id", assesseeId: "assesseeId", reference: "reference" },
  refunds: { tenantId: "tenantId", receiptId: "receiptId", status: "status", id: "id" },
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
vi.mock("../src/modules/collection/repo.js", () => ({ getDemandBalanceTx: vi.fn().mockResolvedValue(0n) }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((...a: any[]) => a), and: vi.fn((...a: any[]) => a), desc: vi.fn() }));

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
function buildMsg() {
  return {
    messageId: "msg-1",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    payload: { receiptId: "receipt-1", reason: "Duplicate payment" },
  };
}

describe("refundCreate duplicate prevention (GAP-REVENUE-REFUNDS-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCall = 0;
    mockReceiptLimit.mockResolvedValue([
      { id: "receipt-1", tenantId: "tenant-1", assesseeId: "assessee-1", amountMinor: 100000n },
    ]);
    mockRefundWhere.mockResolvedValue([]);
    registerCollectionConsumers(createMockQueue());
  });

  it("creates the refund when no live refund exists for the receipt", async () => {
    mockRefundWhere.mockResolvedValue([]);
    await handlers["revenue.refund.create"]!(buildMsg());
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("creates a refund when the only prior refund was rejected", async () => {
    mockRefundWhere.mockResolvedValue([{ status: "rejected" }]);
    await handlers["revenue.refund.create"]!(buildMsg());
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("no-ops when a pending refund already exists (no duplicate money-out)", async () => {
    mockRefundWhere.mockResolvedValue([{ status: "pending" }]);
    await handlers["revenue.refund.create"]!(buildMsg());
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("no-ops when an approved refund already exists", async () => {
    mockRefundWhere.mockResolvedValue([{ status: "approved" }]);
    await handlers["revenue.refund.create"]!(buildMsg());
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
