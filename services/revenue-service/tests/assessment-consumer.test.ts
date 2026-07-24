/**
 * Assessment consumer integration tests.
 *
 * Verifies: assessment + demand + DCB insert, outbox events, idempotency,
 * remitDecide maker-checker enforcement.
 *
 * _Requirements: SVC-131, Requirement 7_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "assessment-1" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

const mockSelectFrom = vi.fn().mockReturnThis();
const mockSelectWhere = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

const mockSet = vi.fn().mockReturnThis();
const mockUpdateWhere = vi.fn().mockReturnThis();
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: "rem-1" }]);
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });
mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });

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
        where: vi.fn().mockResolvedValue([{ assesseeId: "assessee-1" }]),
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

vi.mock("../src/modules/assessment/schema.js", () => ({
  assessments: { tenantId: "tenantId", id: "id", version: "version", assesseeId: "assesseeId", rateHeadId: "rateHeadId", status: "status" },
  demands: { tenantId: "tenantId", assessmentId: "assessmentId" },
  dcbEntries: { tenantId: "tenantId", assesseeId: "assesseeId", demandId: "demandId" },
  remissions: { tenantId: "tenantId", assessmentId: "assessmentId", status: "status", id: "id", makerUserId: "makerUserId" },
}));

vi.mock("../src/modules/rate-engine/schema.js", () => ({
  rateSlabs: { tenantId: "tenantId", rateHeadId: "rateHeadId" },
  penaltyRules: { tenantId: "tenantId", rateHeadId: "rateHeadId" },
  rebateRules: { tenantId: "tenantId", rateHeadId: "rateHeadId" },
}));

vi.mock("../src/modules/rate-engine/domain.js", () => ({
  compute: vi.fn().mockReturnValue({
    principal: 100000n,
    rebate: 0n,
    penalty: 0n,
    interest: 0n,
    net: 100000n,
    snapshot: { rateHeadId: "rh-1", baseValue: "1000000", net: "100000" },
  }),
  DomainError: class DomainError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "DomainError";
    }
  },
  assertMakerChecker: (maker: string, checker: string) => {
    if (maker === checker) throw new Error("MAKER_CHECKER_VIOLATION");
  },
}));

vi.mock("../src/modules/assessment/domain.js", () => ({
  assertCanRevise: vi.fn(),
  assertMakerChecker: (maker: string, checker: string) => {
    if (maker === checker) {
      const err = new Error("MAKER_CHECKER_VIOLATION");
      (err as any).code = "MAKER_CHECKER_VIOLATION";
      throw err;
    }
  },
  DomainError: class DomainError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerAssessmentConsumers } from "../src/modules/assessment/consumer.js";

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
    messageId: "msg-assessment-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: {
      assesseeId: "assessee-1",
      rateHeadId: "rh-1",
      financialYear: "2024-25",
      baseValue: "1000000",
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Assessment Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock for select to return empty arrays (for rate slab lookups)
    mockSelectWhere.mockResolvedValue([]);
    // For the assessmentCreate flow, select returns rate data
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
    // Returning for insert
    mockReturning.mockResolvedValue([{ id: "assessment-1" }]);

    const queue = createMockQueue();
    registerAssessmentConsumers(queue);
  });

  describe("assessmentCreate", () => {
    it("inserts assessment + demand + DCB entry and enqueues events", async () => {
      // First insert returns assessment, second returns demand, third is DCB
      mockReturning
        .mockResolvedValueOnce([{ id: "assessment-1" }])
        .mockResolvedValueOnce([{ id: "demand-1" }])
        .mockResolvedValueOnce([{ id: "dcb-1" }]);

      const msg = buildMsg();
      await handlers["revenue.assessment.create"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      // 3 inserts: assessment, demand, DCB entry
      expect(mockInsert).toHaveBeenCalledTimes(3);
      // 2 enqueue calls: demandRaised + audit
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.demand.raised");
      expect(mockEnqueue.mock.calls[1]![1].topic).toBe("audit.event.record");

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:assessments");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:demands:assessee-1");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:dcb:assessee-1");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.assessment.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("assessmentRemitDecide", () => {
    it("throws on maker-checker violation (same user as maker)", async () => {
      // Return a pending remission with makerUserId = actor-1
      mockSelectWhere.mockResolvedValueOnce([{
        id: "rem-1",
        makerUserId: "actor-1",
        status: "pending",
      }]);

      const msg = buildMsg({
        payload: { assessmentId: "assessment-1", approve: true },
        actorId: "actor-1", // same as maker
      });

      await expect(handlers["revenue.assessment.remit_decide"]!(msg)).rejects.toThrow(
        "MAKER_CHECKER_VIOLATION",
      );
    });

    it("skips processing on duplicate messageId", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { assessmentId: "assessment-1", approve: true },
      });
      await handlers["revenue.assessment.remit_decide"]!(msg);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });
});
