/**
 * Assessee consumer integration tests.
 *
 * Verifies: DB insert, outbox events, idempotency skip, version conflict error.
 *
 * _Requirements: SVC-131, Requirement 5_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NonRetryableError } from "@civitasone/queue";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([{ id: "assessee-new" }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ returning: mockReturning });

const mockSet = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: "assessee-1" }]);
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ returning: mockUpdateReturning });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) =>
      fn({ insert: mockInsert, update: mockUpdate, select: vi.fn() }),
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

vi.mock("../src/modules/assessee/schema.js", () => ({
  assessees: { tenantId: "tenantId", id: "id", version: "version" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerAssesseeConsumers } from "../src/modules/assessee/consumer.js";

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
    messageId: "msg-assessee-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: {
      assesseeType: "property",
      identifierNo: "PROP-001",
      ownerName: "Test Owner",
      address: "123 Test St",
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Assessee Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const queue = createMockQueue();
    registerAssesseeConsumers(queue);
  });

  describe("assesseeCreate", () => {
    it("inserts a row and enqueues domain + audit events", async () => {
      const msg = buildMsg();
      await handlers["revenue.assessee.create"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);

      // Domain event
      expect(mockEnqueue.mock.calls[0]![1]).toMatchObject({
        topic: "revenue.assessee.created",
        tenantId: "tenant-1",
      });

      // Audit event
      expect(mockEnqueue.mock.calls[1]![1]).toMatchObject({
        topic: "audit.event.record",
        payload: { service: "revenue", action: "assessee.created", resourceType: "assessee" },
      });

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:assessees");
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["revenue.assessee.create"]!(msg);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("assesseeUpdate", () => {
    it("updates a row with version increment and enqueues events", async () => {
      const msg = buildMsg({
        payload: {
          assesseeId: "assessee-1",
          version: 1,
          patch: { ownerName: "Updated Name" },
        },
      });
      await handlers["revenue.assessee.update"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);

      // Domain event
      expect(mockEnqueue.mock.calls[0]![1]).toMatchObject({
        topic: "revenue.assessee.updated",
        payload: { assesseeId: "assessee-1", version: 2, changedFields: ["ownerName"] },
      });

      // Cache invalidation
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:assessees");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("revenue:tenant-1:assessee:assessee-1");
    });

    it("throws NonRetryableError on version conflict (stale version)", async () => {
      // Simulate 0 rows returned from update (version mismatch)
      mockUpdateReturning.mockResolvedValueOnce([]);

      const msg = buildMsg({
        payload: {
          assesseeId: "assessee-1",
          version: 5,
          patch: { ownerName: "Stale Update" },
        },
      });

      await expect(handlers["revenue.assessee.update"]!(msg)).rejects.toThrow(NonRetryableError);
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg({
        payload: { assesseeId: "assessee-1", version: 1, patch: { ownerName: "X" } },
      });
      await handlers["revenue.assessee.update"]!(msg);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });
});
