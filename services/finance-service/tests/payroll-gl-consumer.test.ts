/**
 * Unit tests for the payroll.run.finalized → GL journal consumer.
 *
 * Verifies: payroll.run.finalized → journal entries created → finance.gl.posted/rejected emitted
 *
 * Covers:
 * - Happy path: valid headCodes → balanced journal created → gl.posted emitted
 * - Invalid headCode: unknown code → gl.rejected emitted with reason
 * - Idempotency: duplicate messageId is skipped (markProcessed returns false)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue
// ---------------------------------------------------------------------------
type Handler = (msg: any) => Promise<void>;
class TestMemoryQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: any): Promise<string> {
    const msg = {
      messageId: input.messageId ?? randomUUID(),
      type: input.type ?? topic,
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      timestamp: new Date().toISOString(),
      schemaVersion: input.schemaVersion ?? "1.0",
      payload: input.payload,
    };
    const handlers = this.handlers.get(topic) ?? [];
    for (const h of handlers) await h(msg);
    return msg.messageId;
  }
  subscribe(topic: string, handler: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const {
  mockTx,
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
  findHeadByCodeTxMock,
  findHeadByIdTxMock,
  insertJournalMock,
  insertLedgerLineMock,
  insertJournalLineMock,
  findJournalByIdTxMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _enqueueMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _findHeadByCodeTxMock = vi.fn(async (_tx: unknown, _tenantId: string, code: string) => {
    // Default: all head codes resolve to UUIDs
    return { id: `head-${code}`, code, name: `Head ${code}`, tenantId: "10000000-aaaa-4000-8000-000000000001" };
  });
  const _findHeadByIdTxMock = vi.fn(async (_tx: unknown, id: string) => {
    return { id, code: "4100", name: "Salary Expense", classification: "expense" };
  });
  const _insertJournalMock = vi.fn(async () => undefined);
  const _insertLedgerLineMock = vi.fn(async () => undefined);
  const _insertJournalLineMock = vi.fn(async () => undefined);
  const _findJournalByIdTxMock = vi.fn(async () => null);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: _enqueueMock as any,
    markProcessedMock: _markProcessedMock as any,
    findHeadByCodeTxMock: _findHeadByCodeTxMock as any,
    findHeadByIdTxMock: _findHeadByIdTxMock as any,
    insertJournalMock: _insertJournalMock as any,
    insertLedgerLineMock: _insertLedgerLineMock as any,
    insertJournalLineMock: _insertJournalLineMock as any,
    findJournalByIdTxMock: _findJournalByIdTxMock as any,
  };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: any[]) => enqueueMock(...args),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    invalidateResource: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
    put: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/modules/gl/repo.js", () => ({
  insertJournal: (...args: any[]) => insertJournalMock(...args),
  insertLedgerLine: (...args: any[]) => insertLedgerLineMock(...args),
  insertJournalLine: (...args: any[]) => insertJournalLineMock(...args),
  findJournalByIdTx: (...args: any[]) => findJournalByIdTxMock(...args),
  findJournalById: vi.fn(async () => null),
  markJournalReversed: vi.fn(async () => undefined),
  resolveHeadId: vi.fn(async () => null),
}));

vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: (...args: any[]) => findHeadByCodeTxMock(...args),
  findHeadByIdTx: (...args: any[]) => findHeadByIdTxMock(...args),
  findBudget: vi.fn(async () => null),
  findSanctionByIdTx: vi.fn(async () => null),
  incrementSanctionUtilisedGuarded: vi.fn(async () => true),
}));

vi.mock("../src/modules/period-close/routes.js", () => ({
  getPeriodStatus: vi.fn(async () => "open"),
}));

vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate: vi.fn(() => "2025-26"),
  nextVoucherNo: vi.fn(async () => ({ voucherNo: "PAY/001" })),
}));

vi.mock("../src/modules/org-structure/domain.js", () => ({
  validateOrgAssignment: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerGlConsumers(q as any);
  await q.start();
  return q;
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  findJournalByIdTxMock.mockResolvedValue(null);
  findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => {
    // Return UUIDs so resolveHeadIdTx passes through without re-resolving
    const fakeUuid = `00000000-0000-4000-8000-${code.padStart(12, "0")}`;
    return { id: fakeUuid, code, name: `Head ${code}`, tenantId: TENANT };
  });
  findHeadByIdTxMock.mockImplementation(async (_tx: unknown, id: string) => {
    return { id, code: "4100", name: "Salary Expense", classification: "expense" };
  });
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
// Payroll→GL Consumer Tests
// ---------------------------------------------------------------------------
describe("payroll.run.finalized → GL journal posting", () => {
  const BASE_PAYLOAD = {
    runId: "run-001",
    tenantId: TENANT,
    fy: "2025-26",
    entries: [
      { headCode: "4100", debitMinor: "5000000", creditMinor: "0" },
      { headCode: "2100", debitMinor: "0", creditMinor: "5000000" },
    ],
  };

  describe("happy path: journal created with balanced entries, gl.posted emitted", () => {
    it("creates a journal and emits finance.gl.posted when all headCodes are valid", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, BASE_PAYLOAD),
      );

      // markProcessed should have been called
      expect(markProcessedMock).toHaveBeenCalledTimes(1);

      // headCode validation: findHeadByCodeTx should be called for each entry
      expect(findHeadByCodeTxMock).toHaveBeenCalledTimes(2);
      expect(findHeadByCodeTxMock).toHaveBeenCalledWith(expect.anything(), TENANT, "4100");
      expect(findHeadByCodeTxMock).toHaveBeenCalledWith(expect.anything(), TENANT, "2100");

      // Journal should be inserted (via postJournal → repo.insertJournal)
      expect(insertJournalMock).toHaveBeenCalled();
      const journalArgs = insertJournalMock.mock.calls[0][1];
      expect(journalArgs.tenantId).toBe(TENANT);
      expect(journalArgs.type).toBe("payroll");
      expect(journalArgs.status).toBe("posted");
      expect(journalArgs.voucherNo).toContain("PAY/");

      // Ledger lines should be inserted for each entry
      expect(insertLedgerLineMock).toHaveBeenCalledTimes(2);

      // finance.gl.posted event should be emitted
      const postedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === EVENTS.glPosted,
      );
      expect(postedCall).toBeDefined();
      const payload = postedCall![1].payload;
      expect(payload.journalId).toBeDefined();
      expect(payload.voucherNo).toBeDefined();

      await q.stop();
    });

    it("resolves headCodes to UUIDs for the journal lines", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, BASE_PAYLOAD),
      );

      // The journal lines should use resolved head UUIDs as accountCode
      const journalArgs = insertJournalMock.mock.calls[0][1];
      const lines = journalArgs.lines as Array<{ accountCode: string }>;
      expect(lines[0].accountCode).toBe("00000000-0000-4000-8000-000000004100");
      expect(lines[1].accountCode).toBe("00000000-0000-4000-8000-000000002100");

      await q.stop();
    });

    it("uses a deterministic journal ID based on runId", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, BASE_PAYLOAD),
      );

      const journalArgs = insertJournalMock.mock.calls[0][1];
      // Journal ID should be deterministic (SHA-256 based)
      expect(journalArgs.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      await q.stop();
    });
  });

  describe("invalid headCode: gl.rejected emitted with reason", () => {
    it("emits finance.gl.rejected when a headCode does not exist in COA", async () => {
      // Make one headCode fail resolution
      findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => {
        if (code === "9999") return null; // Unknown head code
        return { id: `head-${code}`, code, name: `Head ${code}`, tenantId: TENANT };
      });

      const q = await buildQueue();

      const invalidPayload = {
        runId: "run-bad-head",
        tenantId: TENANT,
        fy: "2025-26",
        entries: [
          { headCode: "4100", debitMinor: "3000000", creditMinor: "0" },
          { headCode: "9999", debitMinor: "0", creditMinor: "3000000" }, // invalid
        ],
      };

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, invalidPayload),
      );

      // No journal should be inserted
      expect(insertJournalMock).not.toHaveBeenCalled();

      // finance.gl.rejected event should be emitted
      const rejectedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === EVENTS.glRejected,
      );
      expect(rejectedCall).toBeDefined();
      const payload = rejectedCall![1].payload;
      expect(payload.runId).toBe("run-bad-head");
      expect(payload.reason).toContain("INVALID_HEAD_CODE");
      expect(payload.reason).toContain("9999");

      // gl.posted should NOT have been emitted
      const postedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === EVENTS.glPosted,
      );
      expect(postedCall).toBeUndefined();

      await q.stop();
    });

    it("includes the specific invalid headCode in the rejection reason", async () => {
      findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => {
        if (code === "BADCODE") return null;
        return { id: `head-${code}`, code, name: `Head ${code}`, tenantId: TENANT };
      });

      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, {
          runId: "run-specific-bad",
          tenantId: TENANT,
          fy: "2025-26",
          entries: [
            { headCode: "BADCODE", debitMinor: "1000000", creditMinor: "0" },
            { headCode: "2100", debitMinor: "0", creditMinor: "1000000" },
          ],
        }),
      );

      const rejectedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === EVENTS.glRejected,
      );
      expect(rejectedCall).toBeDefined();
      expect(rejectedCall![1].payload.reason).toContain("BADCODE");

      await q.stop();
    });
  });

  describe("idempotency: duplicate messageId skipped", () => {
    it("skips processing when markProcessed returns false", async () => {
      markProcessedMock.mockResolvedValue(false);
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, BASE_PAYLOAD),
      );

      // No headCode resolution should happen
      expect(findHeadByCodeTxMock).not.toHaveBeenCalled();

      // No journal should be inserted
      expect(insertJournalMock).not.toHaveBeenCalled();

      // No events should be emitted
      const postedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === EVENTS.glPosted,
      );
      const rejectedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === EVENTS.glRejected,
      );
      expect(postedCall).toBeUndefined();
      expect(rejectedCall).toBeUndefined();

      await q.stop();
    });
  });

  describe("cache invalidation", () => {
    it("invalidates journals cache after successful processing", async () => {
      const { cache } = await import("../src/shared/infra.js");
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.payrollRunFinalized,
        makeMsg(CONSUMED_EVENTS.payrollRunFinalized, BASE_PAYLOAD),
      );

      expect(cache.invalidateResource).toHaveBeenCalledWith(TENANT, "journals");

      await q.stop();
    });
  });
});
