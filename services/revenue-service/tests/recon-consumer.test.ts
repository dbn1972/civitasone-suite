/**
 * Recon (bank reconciliation) consumer integration tests.
 *
 * Verifies: updates receipt.reconciled=true, logs warning if no match,
 * outbox audit event, idempotency.
 *
 * _Requirements: SVC-139, Requirement 16_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([]);
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

const mockLoggerWarn = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) =>
      fn({ insert: mockInsert, select: mockSelect, update: mockUpdate }),
    ),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn().mockResolvedValue(undefined),
    getOrLoad: vi.fn(),
  },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/modules/collection/schema.js", () => ({
  receipts: { tenantId: "tenantId", id: "id", reference: "reference" },
}));

vi.mock("pino", () => ({
  pino: () => ({
    warn: (...args: any[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerReconConsumers } from "../src/modules/collection/recon-consumer.js";

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
    messageId: "msg-recon-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    occurredAt: new Date().toISOString(),
    payload: {
      reference: "UTR-ABC-123",
      reconLineId: "recon-line-1",
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Recon Consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const queue = createMockQueue();
    registerReconConsumers(queue);
  });

  describe("bankStatementReconciled", () => {
    it("updates receipt.reconciled=true when matching receipt found", async () => {
      // Return a matching receipt
      mockSelectLimit.mockResolvedValueOnce([{
        id: "receipt-1",
        reference: "UTR-ABC-123",
        reconciled: false,
      }]);

      const msg = buildMsg();
      await handlers["finance.bank_statement.reconciled"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith({ reconciled: true, reconLineId: "recon-line-1" });

      // Audit event
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue.mock.calls[0]![1]).toMatchObject({
        topic: "audit.event.record",
        payload: {
          service: "revenue",
          action: "reconcile",
          resourceType: "receipt",
          resourceId: "receipt-1",
          outcome: "success",
        },
      });
    });

    it("logs warning if no matching receipt found", async () => {
      // No matching receipt
      mockSelectLimit.mockResolvedValueOnce([]);

      const msg = buildMsg({
        payload: { reference: "UNKNOWN-REF", reconLineId: "recon-line-2" },
      });
      await handlers["finance.bank_statement.reconciled"]!(msg);

      expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("No receipt found for reconciliation reference UNKNOWN-REF"),
      );
    });

    it("skips processing on duplicate messageId (idempotency)", async () => {
      mockMarkProcessed.mockResolvedValueOnce(false);
      const msg = buildMsg();
      await handlers["finance.bank_statement.reconciled"]!(msg);

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });
});
