/**
 * Billing consumer — coverage gap for no-demand error path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

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

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn({
      insert: (...a: any[]) => mockInsert(...a),
      select: () => chainableSelect(),
      update: vi.fn(),
    })),
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
}));

vi.mock("../src/modules/billing/schema.js", () => ({ bills: Symbol("bills") }));
vi.mock("../src/modules/assessment/schema.js", () => ({ demands: Symbol("demands"), dcbEntries: Symbol("dcb") }));
vi.mock("../src/modules/rate-engine/schema.js", () => ({ rateHeads: Symbol("rateHeads") }));
vi.mock("../src/modules/billing/domain.js", () => ({
  generateBillFromDemand: vi.fn((d: any, cat: string, seq: number, date: string) => ({
    assesseeId: d.assesseeId, demandId: d.id, assessmentId: d.assessmentId,
    billNo: `BILL-${seq}`, billDate: date, dueDate: d.dueDate,
    principalMinor: d.principalMinor, rebateMinor: d.rebateMinor, penaltyMinor: d.penaltyMinor,
    totalMinor: d.netMinor, receiptHeadCode: cat,
  })),
}));

import { registerBillingConsumers } from "../src/modules/billing/consumer.js";

type Handler = (msg: any) => Promise<void>;
const handlers: Record<string, Handler> = {};

describe("Billing Consumer — no-demand error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txSelectResults = [];
    txSelectCallIndex = 0;
    const q = { subscribe: vi.fn((t: string, h: Handler) => { handlers[t] = h; }), publish: vi.fn(), start: vi.fn(), stop: vi.fn() } as any;
    registerBillingConsumers(q);
  });

  it("throws when no demand found for assessment", async () => {
    txSelectResults = [[]]; // no demand
    await expect(
      handlers["revenue.bill.generate"]!({ messageId: "m-1", tenantId: "t-1", actorId: "a-1", correlationId: "c-1", payload: { assessmentId: "none" } }),
    ).rejects.toThrow("No demand found");
  });
});
