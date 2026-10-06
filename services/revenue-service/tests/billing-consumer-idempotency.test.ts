/**
 * GAP-REVENUE-BILLS-01 — the billGenerate consumer must be idempotent per
 * assessment: a retry for an assessment that already has an issued bill must
 * NOT create a second bill (no duplicate dues).
 *
 * Mock-based, mirroring billing-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  db: { transaction: vi.fn(async (fn: any) => fn({ insert: mockInsert, select: mockSelect, update: vi.fn() })) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => mockCacheInvalidate(...args), getOrLoad: vi.fn() },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/modules/billing/schema.js", () => ({ bills: Symbol("bills") }));
vi.mock("../src/modules/assessment/schema.js", () => ({ demands: Symbol("demands"), dcbEntries: Symbol("dcbEntries") }));
vi.mock("../src/modules/rate-engine/schema.js", () => ({ rateHeads: Symbol("rateHeads") }));
vi.mock("../src/modules/billing/domain.js", () => ({
  generateBillFromDemand: vi.fn((demand: any, cat: string, seq: number, billDate: string) => ({
    assesseeId: demand.assesseeId,
    demandId: demand.id,
    assessmentId: demand.assessmentId,
    billNo: `BILL-${seq}`,
    billDate,
    dueDate: demand.dueDate,
    principalMinor: demand.principalMinor,
    rebateMinor: demand.rebateMinor,
    penaltyMinor: demand.penaltyMinor,
    totalMinor: demand.netMinor,
    receiptHeadCode: cat,
  })),
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((...a: any[]) => a), and: vi.fn((...a: any[]) => a) }));

import { registerBillingConsumers } from "../src/modules/billing/consumer.js";

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
    payload: { assessmentId: "assessment-1" },
    ...overrides,
  };
}

describe("billGenerate per-assessment idempotency (GAP-REVENUE-BILLS-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const queue = createMockQueue();
    // select order: 1) demand 2) rateHead 3) existing tenant bills
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
      .mockResolvedValueOnce([{ id: "rh-1", category: "property_tax" }])
      // existing bills ALREADY contains one for assessment-1 → duplicate
      .mockResolvedValueOnce([{ id: "existing-bill", assessmentId: "assessment-1" }]);
    registerBillingConsumers(queue);
  });

  it("no-ops when a bill already exists for the assessment (no second bill, no events)", async () => {
    await handlers["revenue.bill.generate"]!(buildMsg({ messageId: "msg-retry" }));

    expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
    // No bill inserted, no domain/audit events enqueued.
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
