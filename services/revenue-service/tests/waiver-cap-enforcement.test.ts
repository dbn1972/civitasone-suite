/**
 * GAP-REVENUE-WAIVERS-01 (server-side cap) — the penalty/interest cap on a
 * waiver was previously enforced ONLY in the web WaiverForm. A crafted API
 * request could therefore waive MORE than the chosen demand's accrued
 * penalty/interest, or a non-positive amount. The waiverCreate command
 * consumer is now the authority: it loads the tenant-scoped demand, caps the
 * amount at the chosen component(s) (penalty / interest / both), and rejects
 * (fail closed) a missing demand, a non-positive amount, or an over-cap amount.
 *
 * Two layers are proven:
 *  1. the pure domain cap math (`waiverCap`, `validateWaiver`);
 *  2. the consumer wiring (loads the demand, derives the cap from waiverType,
 *     rejects / inserts), using the same mock-DB harness as
 *     arrears-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waiverCap, validateWaiver, DomainError } from "../src/modules/arrears/domain.js";

// ── Layer 1: pure domain cap math ──────────────────────────────────────────────

describe("waiverCap (GAP-REVENUE-WAIVERS-01)", () => {
  it("caps a 'penalty' waiver at the demand penalty only", () => {
    expect(waiverCap("penalty", 30000n, 12000n)).toBe(30000n);
  });
  it("caps an 'interest' waiver at the demand interest only", () => {
    expect(waiverCap("interest", 30000n, 12000n)).toBe(12000n);
  });
  it("caps a 'both' waiver at penalty + interest combined", () => {
    expect(waiverCap("both", 30000n, 12000n)).toBe(42000n);
  });
});

describe("validateWaiver (GAP-REVENUE-WAIVERS-01)", () => {
  it("allows an amount up to and including the cap", () => {
    expect(() => validateWaiver(42000n, 42000n)).not.toThrow();
    expect(() => validateWaiver(1n, 42000n)).not.toThrow();
  });
  it("rejects an amount over the cap (no over-waive)", () => {
    expect(() => validateWaiver(42001n, 42000n)).toThrow(DomainError);
    expect(() => validateWaiver(42001n, 42000n)).toThrow(/exceeds waivable/i);
  });
  it("rejects a zero or negative amount", () => {
    expect(() => validateWaiver(0n, 42000n)).toThrow(DomainError);
    expect(() => validateWaiver(-5n, 42000n)).toThrow(/must be positive/i);
  });
});

// ── Layer 2: consumer wiring (mock-DB harness, as arrears-consumer.test.ts) ─────

const mockValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

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

vi.mock("../src/modules/arrears/schema.js", () => ({
  instalmentPlans: { id: "id", tenantId: "tenantId" },
  instalments: Symbol("instalments"),
  writeOffs: { tenantId: "tenantId", id: "id", assesseeId: "assesseeId", makerUserId: "makerUserId" },
  recoveryReferrals: Symbol("recoveryReferrals"),
}));

vi.mock("../src/modules/trade-license/schema.js", () => ({
  waivers: { tenantId: "tenantId", id: "id", requestedBy: "requestedBy", status: "status" },
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: { tenantId: "tenantId", assesseeId: "assesseeId", balanceMinor: "balanceMinor" },
  demands: { tenantId: "tenantId", id: "id", penaltyMinor: "penaltyMinor", interestMinor: "interestMinor" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: vi.fn().mockReturnValue("sql"),
}));

import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";

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
function buildMsg(payload: Record<string, unknown>, overrides: Partial<any> = {}) {
  return {
    messageId: "msg-waiver-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload,
    ...overrides,
  };
}

// A demand with penalty 30000 (₹300) + interest 12000 (₹120) accrued.
const DEMAND = [{ penaltyMinor: 30000n, interestMinor: 12000n }];

describe("waiverCreate consumer — server-side cap (GAP-REVENUE-WAIVERS-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockSelectLimit.mockResolvedValue(DEMAND);
    const queue = createMockQueue();
    registerArrearsConsumers(queue);
  });

  it("inserts the waiver when the amount is within the 'both' cap (penalty + interest)", async () => {
    await handlers["revenue.waiver.create"]!(
      buildMsg({ demandId: "demand-1", waiverType: "both", amountMinor: "42000", reason: "hardship" }),
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockValues.mock.calls[0]![0];
    expect(row.demandId).toBe("demand-1");
    expect(row.amountMinor).toBe("42000");
    expect(row.status).toBe("pending");
    expect(row.requestedBy).toBe("actor-1");
    // audit event enqueued
    expect(mockEnqueue.mock.calls.some((c) => c[1].topic === "audit.event.record")).toBe(true);
  });

  it("rejects a 'penalty' waiver that exceeds the demand's penalty, with no insert", async () => {
    await expect(
      handlers["revenue.waiver.create"]!(
        buildMsg({ demandId: "demand-1", waiverType: "penalty", amountMinor: "30001", reason: "over" }),
      ),
    ).rejects.toThrow(/exceeds waivable/i);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("allows a 'penalty' waiver only up to the penalty component (not penalty+interest)", async () => {
    // 42000 would be fine for 'both' but must be rejected for 'penalty' (cap 30000).
    await expect(
      handlers["revenue.waiver.create"]!(
        buildMsg({ demandId: "demand-1", waiverType: "penalty", amountMinor: "42000", reason: "wrong component" }),
      ),
    ).rejects.toThrow(/exceeds waivable/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount", async () => {
    await expect(
      handlers["revenue.waiver.create"]!(
        buildMsg({ demandId: "demand-1", waiverType: "both", amountMinor: "0", reason: "zero" }),
      ),
    ).rejects.toThrow(/must be positive/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects (fail closed) when the referenced demand does not exist for the tenant", async () => {
    mockSelectLimit.mockResolvedValue([]); // no demand row
    await expect(
      handlers["revenue.waiver.create"]!(
        buildMsg({ demandId: "ghost", waiverType: "both", amountMinor: "100", reason: "no demand" }),
      ),
    ).rejects.toThrow(/not found/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("caps against what is ALREADY waived (pending + approved) on the demand, so N requests cannot each take the full cap", async () => {
    // First select (demand) keeps the {limit} chain; second (SUM of existing
    // waivers) is awaited directly. 30000 already waived of a 42000 'both' cap.
    mockSelectWhere
      .mockReturnValueOnce({ limit: mockSelectLimit })
      .mockReturnValueOnce([{ total: "30000" }]);
    await expect(
      handlers["revenue.waiver.create"]!(
        buildMsg({ demandId: "demand-1", waiverType: "both", amountMinor: "12001", reason: "second request" }),
      ),
    ).rejects.toThrow(/exceeds waivable amount 12000/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("allows a further waiver up to the REMAINING cap", async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: mockSelectLimit })
      .mockReturnValueOnce([{ total: "30000" }]);
    await handlers["revenue.waiver.create"]!(
      buildMsg({ demandId: "demand-1", waiverType: "both", amountMinor: "12000", reason: "remainder" }),
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("rejects any further waiver once the cap is fully used", async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: mockSelectLimit })
      .mockReturnValueOnce([{ total: "42000" }]);
    await expect(
      handlers["revenue.waiver.create"]!(
        buildMsg({ demandId: "demand-1", waiverType: "both", amountMinor: "1", reason: "nothing left" }),
      ),
    ).rejects.toThrow(/exceeds waivable amount 0/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("records the waiver component in the audit payload (waiverType is not dropped)", async () => {
    await handlers["revenue.waiver.create"]!(
      buildMsg({ demandId: "demand-1", waiverType: "penalty", amountMinor: "100", reason: "typed" }),
    );
    const audit = mockEnqueue.mock.calls.find((c) => c[1].topic === "audit.event.record")![1];
    expect(audit.payload).toMatchObject({ demandId: "demand-1", amountMinor: "100", waiverType: "penalty" });
  });

  it("defaults to the 'both' cap when waiverType is omitted", async () => {
    // amount 42000 == penalty+interest; allowed only because default is 'both'.
    await handlers["revenue.waiver.create"]!(
      buildMsg({ demandId: "demand-1", amountMinor: "42000", reason: "no type" }),
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a duplicate messageId does nothing", async () => {
    mockMarkProcessed.mockResolvedValueOnce(false);
    await handlers["revenue.waiver.create"]!(
      buildMsg({ demandId: "demand-1", waiverType: "both", amountMinor: "100", reason: "dup" }),
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
