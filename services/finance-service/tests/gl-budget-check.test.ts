/**
 * DOM-007 regression: the GL posting path (gl/consumer.ts postJournal) had no
 * budget check at all — assertBudgetNotExceeded (budget/domain.ts) existed
 * but had zero callers in finance-service. This proves:
 *
 *   1. A journal whose debit against a budget-controlled head exceeds the
 *      head's available budget (re_minor - utilised_minor) is REJECTED —
 *      nothing is inserted.
 *   2. A journal within budget is posted and atomically increments the
 *      head's utilised_minor (via the guarded UPDATE, same shape as the
 *      established incrementSanctionUtilisedGuarded convention).
 *   3. An explicit, pre-authorized override (budgetOverride: true — role
 *      gating happens upstream in gl/routes.ts before this consumer ever
 *      sees the message, see tests/journal-budget-override-routes.test.ts)
 *      posts over budget anyway and emits an audit event recording it.
 *
 * Mocked-DB unit harness, same style/shape as tests/payroll-gl-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue (mirrors payroll-gl-consumer.test.ts)
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
  findBudgetTxMock,
  incrementBudgetUtilisedGuardedMock,
  incrementBudgetUtilisedForcedMock,
} = vi.hoisted(() => {
  const _mockTx = { execute: vi.fn(async () => []) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: vi.fn(async () => undefined) as any,
    markProcessedMock: vi.fn(async () => true) as any,
    findHeadByCodeTxMock: vi.fn() as any,
    findHeadByIdTxMock: vi.fn() as any,
    insertJournalMock: vi.fn(async () => undefined) as any,
    insertLedgerLineMock: vi.fn(async () => undefined) as any,
    insertJournalLineMock: vi.fn(async () => undefined) as any,
    findJournalByIdTxMock: vi.fn(async () => null) as any,
    findBudgetTxMock: vi.fn(async () => null) as any,
    incrementBudgetUtilisedGuardedMock: vi.fn(async () => true) as any,
    incrementBudgetUtilisedForcedMock: vi.fn(async () => undefined) as any,
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
  findBudgetTx: (...args: any[]) => findBudgetTxMock(...args),
  findSanctionByIdTx: vi.fn(async () => null),
  incrementSanctionUtilisedGuarded: vi.fn(async () => true),
  incrementBudgetUtilisedGuarded: (...args: any[]) => incrementBudgetUtilisedGuardedMock(...args),
  incrementBudgetUtilisedForced: (...args: any[]) => incrementBudgetUtilisedForcedMock(...args),
}));

vi.mock("../src/modules/period-close/repo.js", () => ({
  getPeriodStatusTx: vi.fn(async () => "open"),
}));

vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate: vi.fn(() => "2025-26"),
  nextVoucherNo: vi.fn(async () => ({ voucherNo: "JV/0001" })),
}));

vi.mock("../src/modules/org-structure/domain.js", () => ({
  validateOrgAssignment: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/gl/spine.js", () => ({
  deterministicId: (key: string) => {
    const h = createHash("sha256").update(key).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  },
}));

// gl/domain.js and budget/domain.js are the REAL implementations here on
// purpose — assertJournalBalances must actually validate our balanced test
// journals, and assertBudgetNotExceeded (budget/domain.ts) is the exact
// function DOM-007 requires be wired in; mocking it would defeat the test.

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const AUDIT_TOPIC = "audit.event.record";

const EXPENSE_CODE = "5010"; // budget-controlled in these tests
const BANK_CODE = "1100";    // never budget-controlled

function fakeHeadUuid(code: string): string {
  return `00000000-0000-4000-8000-${code.padStart(12, "0")}`;
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.journalPost,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

function journalPayload(overrides: Record<string, unknown> = {}, debitMinor = 150_000) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    voucherNo: "AUTO",
    type: "journal",
    postingDate: "2025-08-15",
    lines: [
      { accountCode: EXPENSE_CODE, debitMinor, creditMinor: 0 },
      { accountCode: BANK_CODE, debitMinor: 0, creditMinor: debitMinor },
    ],
    ...overrides,
  };
}

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerGlConsumers(q as any);
  await q.start();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  findJournalByIdTxMock.mockResolvedValue(null);
  findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => ({
    id: fakeHeadUuid(code), code, name: `Head ${code}`, tenantId: TENANT,
  }));
  findHeadByIdTxMock.mockImplementation(async (_tx: unknown, id: string) => ({
    id, code: "5010", name: "Test Expense Head", classification: "expense",
  }));
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  incrementBudgetUtilisedGuardedMock.mockResolvedValue(true);
  findBudgetTxMock.mockResolvedValue(null); // default: head not budget-controlled
});

describe("DOM-007 — GL posting path budget check", () => {
  it("REGRESSION: rejects a journal whose debit exceeds the budget-controlled head's available budget", async () => {
    findBudgetTxMock.mockImplementation(async (_tx: unknown, headId: string) => {
      if (headId !== fakeHeadUuid(EXPENSE_CODE)) return null;
      return {
        id: "budget-row-1", tenantId: TENANT, headId, fy: "2025-26",
        beMinor: 100_000n, reMinor: 100_000n, allocatedMinor: 100_000n, utilisedMinor: 0n,
        currency: "INR",
      };
    });

    const q = await buildQueue();
    // 150,000 requested against 100,000 available — must be rejected.
    await expect(
      q.publish(COMMANDS.journalPost, makeMsg(journalPayload({}, 150_000)))
    ).rejects.toThrow(/BUDGET_EXCEEDED/);

    expect(insertJournalMock).not.toHaveBeenCalled();
    expect(insertLedgerLineMock).not.toHaveBeenCalled();
    expect(incrementBudgetUtilisedGuardedMock).not.toHaveBeenCalled();
  });

  it("posts a within-budget journal and atomically increments utilised_minor", async () => {
    findBudgetTxMock.mockImplementation(async (_tx: unknown, headId: string) => {
      if (headId !== fakeHeadUuid(EXPENSE_CODE)) return null;
      return {
        id: "budget-row-2", tenantId: TENANT, headId, fy: "2025-26",
        beMinor: 500_000n, reMinor: 500_000n, allocatedMinor: 500_000n, utilisedMinor: 100_000n,
        currency: "INR",
      };
    });

    const q = await buildQueue();
    // 150,000 requested against 400,000 available (500,000 - 100,000) — allowed.
    await q.publish(COMMANDS.journalPost, makeMsg(journalPayload({}, 150_000)));

    expect(insertJournalMock).toHaveBeenCalled();
    expect(incrementBudgetUtilisedGuardedMock).toHaveBeenCalledWith(
      expect.anything(), "budget-row-2", 150_000n, ACTOR,
    );
    expect(incrementBudgetUtilisedForcedMock).not.toHaveBeenCalled();
  });

  it("a head with no finance_budgets row is not budget-controlled and posts unaffected", async () => {
    // findBudgetTxMock default already returns null for every head.
    const q = await buildQueue();
    await q.publish(COMMANDS.journalPost, makeMsg(journalPayload({}, 999_999_999)));
    expect(insertJournalMock).toHaveBeenCalled();
    expect(incrementBudgetUtilisedGuardedMock).not.toHaveBeenCalled();
  });

  describe("explicit, audited override", () => {
    beforeEach(() => {
      findBudgetTxMock.mockImplementation(async (_tx: unknown, headId: string) => {
        if (headId !== fakeHeadUuid(EXPENSE_CODE)) return null;
        return {
          id: "budget-row-3", tenantId: TENANT, headId, fy: "2025-26",
          beMinor: 100_000n, reMinor: 100_000n, allocatedMinor: 100_000n, utilisedMinor: 0n,
          currency: "INR",
        };
      });
    });

    it("allows an over-budget post when budgetOverride is set, and audits it", async () => {
      const q = await buildQueue();
      await q.publish(
        COMMANDS.journalPost,
        makeMsg(journalPayload({ budgetOverride: true, overrideReason: "emergency flood relief sanction" }, 150_000)),
      );

      // Not rejected — journal posted despite exceeding available budget.
      expect(insertJournalMock).toHaveBeenCalled();
      // Forced (unconditional) increment used instead of the guarded one.
      expect(incrementBudgetUtilisedForcedMock).toHaveBeenCalledWith(
        expect.anything(), "budget-row-3", 150_000n, ACTOR,
      );
      expect(incrementBudgetUtilisedGuardedMock).not.toHaveBeenCalled();

      // An audit event records the override with the reason.
      const overrideAudit = enqueueMock.mock.calls.find(
        ([, msg]: [unknown, { topic: string; payload: Record<string, unknown> }]) =>
          msg.topic === AUDIT_TOPIC && msg.payload.action === "post_journal_budget_override",
      );
      expect(overrideAudit).toBeDefined();
      const auditPayload = overrideAudit![1].payload as Record<string, unknown>;
      expect(auditPayload.reason).toBe("emergency flood relief sanction");
      expect(auditPayload.requestedMinor).toBe("150000");
      expect(auditPayload.availableMinor).toBe("100000");
    });

    it("does NOT become a universal bypass: budgetOverride true but still within budget skips the override audit", async () => {
      const q = await buildQueue();
      // 50,000 requested against 100,000 available — no overdraw actually occurs.
      await q.publish(
        COMMANDS.journalPost,
        makeMsg(journalPayload({ budgetOverride: true, overrideReason: "just in case" }, 50_000)),
      );
      expect(insertJournalMock).toHaveBeenCalled();
      const overrideAudit = enqueueMock.mock.calls.find(
        ([, msg]: [unknown, { topic: string; payload: Record<string, unknown> }]) =>
          msg.topic === AUDIT_TOPIC && msg.payload.action === "post_journal_budget_override",
      );
      expect(overrideAudit).toBeUndefined();
      // Still uses the forced (unconditional) writer, matching the non-guarded
      // override branch — but no overdraw means no audit event was warranted.
      expect(incrementBudgetUtilisedForcedMock).toHaveBeenCalledWith(
        expect.anything(), "budget-row-3", 50_000n, ACTOR,
      );
    });
  });
});
