/**
 * Collection consumer — coverage gaps for refundCreate/refundDecide paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
const mockGetDemandBalance = vi.fn().mockResolvedValue(500000n);

let txSelectResults: any[][] = [];
let txSelectCallIndex = 0;

function chainableSelect() {
  const getResult = () => txSelectResults[txSelectCallIndex++] ?? [];
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => Promise.resolve(getResult())),
    then: (resolve: any) => Promise.resolve(getResult()).then(resolve),
  };
  return chain;
}

const mockInsertReturning = vi.fn().mockResolvedValue([{ id: "new-1" }]);
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockSetWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn({
      insert: (...a: any[]) => mockInsert(...a),
      select: () => chainableSelect(),
      update: (...a: any[]) => mockUpdate(...a),
    })),
    select: () => chainableSelect(),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => mockCacheInvalidate(...args), getOrLoad: vi.fn().mockResolvedValue([]) },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: any[]) => a), and: vi.fn((...a: any[]) => a), desc: vi.fn(),
  sql: vi.fn().mockReturnValue({ mapWith: vi.fn().mockReturnValue("sql") }),
}));

vi.mock("../src/modules/collection/schema.js", () => ({
  receipts: { tenantId: "t", id: "id", assesseeId: "ai", reference: "r" },
  refunds: { tenantId: "t", id: "id", assesseeId: "ai", makerUserId: "mu" },
  adjustments: Symbol("adj"),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: { tenantId: "t", assesseeId: "ai", demandId: "di", createdAt: "ca", balanceMinor: "bm" },
}));

vi.mock("../src/modules/collection/domain.js", () => ({
  validateReceipt: vi.fn(),
  validateRefund: vi.fn(),
  validateAdjustment: vi.fn(),
  assertMakerChecker: (m: string, c: string) => { if (m === c) throw new Error("MAKER_CHECKER_VIOLATION"); },
}));

vi.mock("../src/modules/collection/repo.js", () => ({
  getDemandBalance: (...args: any[]) => mockGetDemandBalance(...args),
}));

import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";

type Handler = (msg: any) => Promise<void>;
const handlers: Record<string, Handler> = {};

function msg(overrides: any = {}) {
  return { messageId: "m-1", tenantId: "t-1", actorId: "a-1", correlationId: "c-1", payload: {}, ...overrides };
}

describe("Collection Consumer — refundCreate/refundDecide gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txSelectResults = [];
    txSelectCallIndex = 0;
    mockGetDemandBalance.mockResolvedValue(500000n);
    const q = { subscribe: vi.fn((t: string, h: Handler) => { handlers[t] = h; }), publish: vi.fn(), start: vi.fn(), stop: vi.fn() } as any;
    registerCollectionConsumers(q);
  });

  it("refundCreate: inserts pending refund when receipt exists", async () => {
    txSelectResults = [[{ id: "r-1", assesseeId: "ae-1", amountMinor: 100000n }]];
    await handlers["revenue.refund.create"]!(msg({ payload: { receiptId: "r-1", reason: "Dup" } }));
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
  });

  it("refundCreate: skips when receipt not found", async () => {
    txSelectResults = [[]];
    await handlers["revenue.refund.create"]!(msg({ payload: { receiptId: "x", reason: "y" } }));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refundDecide approve: inserts DCB entry and enqueues events", async () => {
    txSelectResults = [[{ id: "rf-1", makerUserId: "maker-1", assesseeId: "ae-1", amountMinor: 50000n, reason: "Over" }]];
    await handlers["revenue.refund.decide"]!(msg({ actorId: "checker-1", payload: { refundId: "rf-1", approve: true, reason: "OK" } }));
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.refund.processed");
  });

  it("refundDecide reject: no DCB, only audit", async () => {
    txSelectResults = [[{ id: "rf-2", makerUserId: "maker-1", assesseeId: "ae-1", amountMinor: 30000n, reason: "E" }]];
    await handlers["revenue.refund.decide"]!(msg({ actorId: "checker-1", payload: { refundId: "rf-2", approve: false } }));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
  });

  it("refundDecide: skips when refund not found", async () => {
    txSelectResults = [[]];
    await handlers["revenue.refund.decide"]!(msg({ actorId: "c-1", payload: { refundId: "none", approve: true } }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
