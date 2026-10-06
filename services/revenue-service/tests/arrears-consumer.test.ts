/**
 * Arrears consumer integration tests.
 *
 * Verifies: instalment schedule generation, writeOffDecide maker-checker,
 * outbox events, idempotency.
 *
 * _Requirements: SVC-137, Requirement 13_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "plan-1" }]);
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

vi.mock("../src/modules/arrears/schema.js", () => ({
  instalmentPlans: { id: "id", tenantId: "tenantId" },
  instalments: Symbol("instalments"),
  writeOffs: { tenantId: "tenantId", id: "id", assesseeId: "assesseeId", makerUserId: "makerUserId" },
  recoveryReferrals: Symbol("recoveryReferrals"),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: { tenantId: "tenantId", assesseeId: "assesseeId", balanceMinor: "balanceMinor", entryType: "entryType", demandId: "demandId", amountMinor: "amountMinor", createdAt: "createdAt" },
}));

vi.mock("../src/modules/arrears/domain.js", () => ({
  generateInstalmentSchedule: vi.fn((total: bigint, count: number, startDate: string) => {
    const perInstalment = total / BigInt(count);
    const entries = [];
    for (let i = 0; i < count; i++) {
      entries.push({
        sequenceNo: i + 1,
        dueDate: `2025-0${i + 1}-01`,
        amountMinor: perInstalment,
      });
    }
    return entries;
  }),
  validateWriteOff: vi.fn(),
  validateRecoveryReferral: (outstanding: bigint) => {
    if (outstanding <= 0n) {
      const err = new Error("Recovery referral requires outstanding arrears; this assessee has none");
      (err as any).code = "NO_OVERDUE_ARREARS";
      throw err;
    }
  },
  assertMakerChecker: (maker: string, checker: string) => {
    if (maker === checker) {
      const err = new Error("MAKER_CHECKER_VIOLATION");
      (err as any).code = "MAKER_CHECKER_VIOLATION";
      throw err;
    }
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: vi.fn().mockReturnValue("sql"),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";

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
    messageId: "msg-arrears-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: {
      assesseeId: "assessee-1",
      instalmentCount: 4,
      startDate: "2025-01-01",
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Arrears Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: select returns DCB balance row
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
    mockSelectLimit.mockResolvedValue([{ total: 400000n }]);
    mockReturning.mockResolvedValue([{ id: "plan-1" }]);

    const queue = createMockQueue();
    registerArrearsConsumers(queue);
  });

  describe("instalmentPlanCreate", () => {
    it("generates instalment schedule and inserts plan + instalments", async () => {
      const msg = buildMsg();
      await handlers["revenue.instalment.create"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 1 select (DCB balance), 1 insert plan + 4 insert instalments = 5 inserts
      expect(mockInsert).toHaveBeenCalledTimes(5);
      // 2 enqueue: instalmentPlanCreated + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.instalment.created");
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:instalments:assessee-1");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.instalment.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("writeOffCreate (GAP-REVENUE-WRITE-OFFS-03)", () => {
    it("stores the optional demandId + financialYear on the write-off row", async () => {
      const msg = buildMsg({
        payload: {
          assesseeId: "assessee-1",
          amountMinor: "100000",
          reason: "Irrecoverable",
          demandId: "demand-9",
          financialYear: "2024-25",
        },
      });
      await handlers["revenue.write_off.create"]!(msg);
      // The last insert is the write-off; its values carry the demand reference.
      const insertedValues = mockValues.mock.calls.map((c) => c[0]);
      const woRow = insertedValues.find((v) => v && v.reason === "Irrecoverable");
      expect(woRow).toBeTruthy();
      expect(woRow.demandId).toBe("demand-9");
      expect(woRow.financialYear).toBe("2024-25");
    });

    it("stores null demand reference when none is given (backward compatible)", async () => {
      const msg = buildMsg({
        payload: { assesseeId: "assessee-1", amountMinor: "100000", reason: "No demand ref" },
      });
      await handlers["revenue.write_off.create"]!(msg);
      const woRow = mockValues.mock.calls.map((c) => c[0]).find((v) => v && v.reason === "No demand ref");
      expect(woRow.demandId).toBeNull();
      expect(woRow.financialYear).toBeNull();
    });
  });

  describe("writeOffDecide", () => {
    it("throws on maker-checker violation (same user as maker)", async () => {
      // Return a write-off with makerUserId = actor-1
      mockSelectLimit.mockResolvedValueOnce([{
        id: "wo-1",
        makerUserId: "actor-1",
        assesseeId: "assessee-1",
        amountMinor: 100000n,
        reason: "Uncollectable",
      }]);

      const msg = buildMsg({
        payload: { writeOffId: "wo-1", approve: true },
        actorId: "actor-1", // same as maker
      });

      await expect(handlers["revenue.write_off.decide"]!(msg)).rejects.toThrow(
        "MAKER_CHECKER_VIOLATION",
      );
    });

    it("skips processing on duplicate messageId", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { writeOffId: "wo-1", approve: true },
      });
      await handlers["revenue.write_off.decide"]!(msg);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("recoveryRefer", () => {
    it("inserts referral and enqueues events", async () => {
      // GAP-REVENUE-RECOVERY-01: the consumer now checks outstanding arrears
      // first — seed a positive DCB balance so a legitimate referral proceeds.
      mockSelectWhere.mockReturnValueOnce([{ total: 400000n }]);
      const msg = buildMsg({
        payload: { assesseeId: "assessee-1", reason: "Chronic defaulter" },
      });
      await handlers["revenue.recovery.refer"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.recovery.referred");
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:instalments:assessee-1");
    });

    it("rejects a referral when the assessee has no outstanding arrears (GAP-REVENUE-RECOVERY-01)", async () => {
      mockSelectWhere.mockReturnValueOnce([{ total: 0n }]);
      const msg = buildMsg({ payload: { assesseeId: "assessee-1", reason: "No dues" } });

      await expect(handlers["revenue.recovery.refer"]!(msg)).rejects.toThrow(/outstanding arrears/i);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe("waiverDecide (GAP-REVENUE-WAIVERS-03: server-side maker != checker)", () => {
    it("does NOT update when the deciding officer raised the waiver, and audits a maker_checker_violation", async () => {
      mockSelectLimit.mockResolvedValueOnce([{ requestedBy: "actor-1", status: "pending" }]);
      const msg = buildMsg({
        payload: { waiverId: "w-1", approve: true },
        actorId: "actor-1", // same as requester
      });
      await handlers["revenue.waiver.decide"]!(msg);
      expect(mockUpdate).not.toHaveBeenCalled();
      const audit = mockEnqueue.mock.calls.find((c) => c[1].topic === "audit.event.record");
      expect(audit).toBeTruthy();
      expect(audit![1].payload.outcome).toBe("maker_checker_violation");
    });

    it("updates the waiver when a DIFFERENT officer decides a pending waiver", async () => {
      mockSelectLimit.mockResolvedValueOnce([{ requestedBy: "maker-x", status: "pending" }]);
      const msg = buildMsg({
        payload: { waiverId: "w-1", approve: true },
        actorId: "checker-y",
      });
      await handlers["revenue.waiver.decide"]!(msg);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const audit = mockEnqueue.mock.calls.find((c) => c[1].topic === "audit.event.record");
      expect(audit![1].payload.outcome).toBe("approved");
    });

    it("does NOT update an already-decided waiver", async () => {
      mockSelectLimit.mockResolvedValueOnce([{ requestedBy: "maker-x", status: "approved" }]);
      const msg = buildMsg({
        payload: { waiverId: "w-1", approve: false },
        actorId: "checker-y",
      });
      await handlers["revenue.waiver.decide"]!(msg);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
