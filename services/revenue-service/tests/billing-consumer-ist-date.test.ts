/**
 * CLOS2-S6-13: bill date is the IST calendar date, not the UTC date. A bill
 * generated 00:00-05:30 IST must carry that IST day.
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

async function billDateAt(iso: string): Promise<string> {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  try {
    mockSelectWhere
      .mockResolvedValueOnce([
        {
          id: "demand-1", assesseeId: "assessee-1", assessmentId: "assessment-1", rateHeadId: "rh-1",
          financialYear: "2026-27", dueDate: "2027-03-31", principalMinor: 100000n,
          rebateMinor: 0n, penaltyMinor: 0n, netMinor: 100000n,
        },
      ])
      .mockResolvedValueOnce([{ id: "rh-1", category: "property_tax" }])
      .mockResolvedValueOnce([]);
    registerBillingConsumers(createMockQueue());
    await handlers["revenue.bill.generate"]!({
      messageId: "m", tenantId: "tenant-1", actorId: "actor-1", correlationId: "c",
      occurredAt: iso, payload: { assessmentId: "assessment-1" },
    });
    return mockValues.mock.calls[0]![0].billDate as string;
  } finally {
    vi.useRealTimers();
  }
}

describe("Billing Consumer billDate (IST)", () => {
  it("dates a bill generated 00:30 IST with the IST day, not the UTC day", async () => {
    expect(await billDateAt("2026-10-22T19:00:00Z")).toBe("2026-10-23");
  });
  it("control: 23:59:59 IST stays on the same IST day", async () => {
    expect(await billDateAt("2026-10-22T18:29:59Z")).toBe("2026-10-22");
  });
  it("rolls exactly at 18:30Z", async () => {
    expect(await billDateAt("2026-10-22T18:30:00Z")).toBe("2026-10-23");
  });
});
