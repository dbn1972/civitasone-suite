/**
 * Rate Engine consumer integration tests.
 *
 * Verifies: DB insert, outbox events (domain + audit), idempotency skip, cache invalidation.
 *
 * _Requirements: SVC-136, Requirement 2_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "new-id" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn({ insert: mockInsert, select: vi.fn(), update: vi.fn() })),
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

vi.mock("../src/modules/rate-engine/schema.js", () => ({
  rateHeads: Symbol("rateHeads"),
  rateSlabs: Symbol("rateSlabs"),
  penaltyRules: Symbol("penaltyRules"),
  rebateRules: Symbol("rebateRules"),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerRateEngineConsumers } from "../src/modules/rate-engine/consumer.js";

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
    messageId: "msg-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: { code: "PT", name: "Property Tax", category: "property_tax" },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Rate Engine Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const queue = createMockQueue();
    registerRateEngineConsumers(queue);
  });

  describe("rateHeadCreate", () => {
    it("inserts a row and enqueues domain + audit events", async () => {
      const msg = buildMsg();
      await handlers["revenue.rate_head.create"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);

      // Domain event
      expect(mockEnqueue.mock.calls[0]![1]).toMatchObject({
        topic: "revenue.rate_head.created",
        tenantId: "tenant-1",
        actorId: "actor-1",
      });

      // Audit event
      expect(mockEnqueue.mock.calls[1]![1]).toMatchObject({
        topic: "audit.event.record",
        payload: { service: "revenue", action: "create", resourceType: "rate_head", outcome: "success" },
      });

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:rate_heads");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.rate_head.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("rateSlabCreate", () => {
    it("inserts a row and enqueues domain + audit events", async () => {
      const msg = buildMsg({
        payload: {
          rateHeadId: "rh-1",
          slabType: "flat",
          rateValue: 100000n,
          effectiveFrom: "2024-04-01",
        },
      });
      await handlers["revenue.rate_slab.create"]!(msg);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.rate_slab.created");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:rate_slabs:rh-1");
    });

    it("skips processing on duplicate messageId", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { rateHeadId: "rh-1", slabType: "flat", rateValue: 100000n, effectiveFrom: "2024-04-01" },
      });
      await handlers["revenue.rate_slab.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("penaltyRuleCreate", () => {
    it("inserts a row and enqueues domain + audit events", async () => {
      const msg = buildMsg({
        payload: {
          rateHeadId: "rh-1",
          interestType: "simple",
          annualRateBps: 1200,
          graceDays: 30,
        },
      });
      await handlers["revenue.penalty_rule.create"]!(msg);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.penalty_rule.created");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:penalty_rules:rh-1");
    });

    it("skips processing on duplicate messageId", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { rateHeadId: "rh-1", interestType: "simple", annualRateBps: 1200, graceDays: 30 },
      });
      await handlers["revenue.penalty_rule.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe("rebateRuleCreate", () => {
    it("inserts a row and enqueues domain + audit events", async () => {
      const msg = buildMsg({
        payload: {
          rateHeadId: "rh-1",
          rebateType: "early_payment",
          discountBps: 500,
        },
      });
      await handlers["revenue.rebate_rule.create"]!(msg);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.rebate_rule.created");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:rebate_rules:rh-1");
    });

    it("skips processing on duplicate messageId", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { rateHeadId: "rh-1", rebateType: "early_payment", discountBps: 500 },
      });
      await handlers["revenue.rebate_rule.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
    });
  });
});
