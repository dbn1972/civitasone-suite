/**
 * DOM-010 regression tests: three GL posting-path bugs bundled together in
 * the same gap —
 *
 *   1. No leaf-account guard: gl/consumer.ts's postJournal would happily
 *      post to a head that has children in the chart-of-accounts hierarchy
 *      (a "parent"/summary account), silently corrupting roll-up totals for
 *      those children. Fixed by budgetRepo.hasChildHeadsTx + a per-line
 *      guard in postJournal.
 *   2. An unrecognized/malformed accounting period defaulted to "open"
 *      (period-close/repo.ts's `?? "open"` fallback) instead of failing
 *      closed. Fixed by getPeriodStatusTx/getPeriodStatusDb returning
 *      "unknown" for a period that isn't even shaped like YYYY-MM, and
 *      postJournal rejecting that "unknown" status.
 *   3. The gapless voucher-number counter was incremented BEFORE the
 *      journal-id idempotency short-circuit, so a retried/redelivered
 *      duplicate request permanently burned a voucher number even though
 *      the journal itself was correctly skipped as already-posted. Fixed by
 *      moving voucher allocation to run AFTER that idempotency check.
 *
 * Harness mirrors tests/gl-budget-check.test.ts (mocked-DB unit style).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue (mirrors gl-budget-check.test.ts)
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
  hasChildHeadsTxMock,
  insertJournalMock,
  insertLedgerLineMock,
  insertJournalLineMock,
  findJournalByIdTxMock,
  findBudgetTxMock,
  incrementBudgetUtilisedGuardedMock,
  incrementBudgetUtilisedForcedMock,
  getPeriodStatusTxMock,
  nextVoucherNoMock,
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
    hasChildHeadsTxMock: vi.fn(async () => false) as any,
    insertJournalMock: vi.fn(async () => undefined) as any,
    insertLedgerLineMock: vi.fn(async () => undefined) as any,
    insertJournalLineMock: vi.fn(async () => undefined) as any,
    findJournalByIdTxMock: vi.fn(async () => null) as any,
    findBudgetTxMock: vi.fn(async () => null) as any,
    incrementBudgetUtilisedGuardedMock: vi.fn(async () => true) as any,
    incrementBudgetUtilisedForcedMock: vi.fn(async () => undefined) as any,
    getPeriodStatusTxMock: vi.fn(async () => "open") as any,
    nextVoucherNoMock: vi.fn(async () => ({ voucherNo: "JV/2025-26/000001", seq: 1 })) as any,
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
  hasChildHeadsTx: (...args: any[]) => hasChildHeadsTxMock(...args),
}));

vi.mock("../src/modules/period-close/repo.js", () => ({
  getPeriodStatusTx: (...args: any[]) => getPeriodStatusTxMock(...args),
}));

vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate: vi.fn(() => "2025-26"),
  nextVoucherNo: (...args: any[]) => nextVoucherNoMock(...args),
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

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

const EXPENSE_CODE = "5010"; // stands in for the "parent" head in test (1)
const BANK_CODE = "1100";

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
  findBudgetTxMock.mockResolvedValue(null); // head not budget-controlled — irrelevant to these tests
  hasChildHeadsTxMock.mockResolvedValue(false); // default: every head is a leaf
  getPeriodStatusTxMock.mockResolvedValue("open"); // default: period is genuinely open
  nextVoucherNoMock.mockImplementation(async () => ({ voucherNo: "JV/2025-26/000001", seq: 1 }));
});

describe("DOM-010 (1) — GL leaf-account guard", () => {
  it("REGRESSION: rejects posting to a head that has child accounts (a parent/summary account)", async () => {
    // The expense head is a "parent" in the chart-of-accounts hierarchy —
    // some other head declares it as their parentId.
    hasChildHeadsTxMock.mockImplementation(
      async (_tx: unknown, headId: string) => headId === fakeHeadUuid(EXPENSE_CODE),
    );

    const q = await buildQueue();
    await expect(
      q.publish(COMMANDS.journalPost, makeMsg(journalPayload())),
    ).rejects.toThrow(/NOT_LEAF_ACCOUNT/);

    expect(insertJournalMock).not.toHaveBeenCalled();
    expect(insertLedgerLineMock).not.toHaveBeenCalled();
  });

  it("posts normally to heads with no children (genuine leaves) — no regression for the common case", async () => {
    hasChildHeadsTxMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.journalPost, makeMsg(journalPayload()));
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
  });
});

describe("DOM-010 (2) — unknown period fails closed instead of defaulting open", () => {
  it("REGRESSION: rejects posting into a period the system does not recognise", async () => {
    // period-close/repo.ts's getPeriodStatusTx now returns "unknown" for a
    // period that isn't shaped like a real YYYY-MM period at all.
    getPeriodStatusTxMock.mockResolvedValue("unknown");

    const q = await buildQueue();
    await expect(
      q.publish(COMMANDS.journalPost, makeMsg(journalPayload())),
    ).rejects.toThrow(/PERIOD_UNKNOWN/);

    expect(insertJournalMock).not.toHaveBeenCalled();
  });

  it("still posts normally to a genuinely open, well-formed period — no regression for the common case", async () => {
    getPeriodStatusTxMock.mockResolvedValue("open");
    const q = await buildQueue();
    await q.publish(COMMANDS.journalPost, makeMsg(journalPayload()));
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
  });
});

describe("DOM-010 (3) — voucher number allocated AFTER the idempotency check", () => {
  it("REGRESSION: a retried/redelivered duplicate request does not burn a voucher number", async () => {
    const q = await buildQueue();
    const payload = journalPayload(); // fixed journal.id, reused for both publishes

    // First delivery: the journal does not exist yet — voucher IS allocated
    // and the journal IS posted.
    findJournalByIdTxMock.mockResolvedValueOnce(null);
    await q.publish(COMMANDS.journalPost, makeMsg(payload));
    expect(nextVoucherNoMock).toHaveBeenCalledTimes(1);
    expect(insertJournalMock).toHaveBeenCalledTimes(1);

    // Retried/redelivered: identical journal payload (same journal.id)
    // republished under a brand-new messageId — exactly what a real
    // outbox/queue redelivery (or a duplicate client request racing one)
    // looks like. The journal now exists, so the idempotency short-circuit
    // must fire BEFORE voucher allocation is ever reached.
    findJournalByIdTxMock.mockResolvedValue({ id: payload.id });
    await q.publish(COMMANDS.journalPost, makeMsg(payload));

    expect(insertJournalMock).toHaveBeenCalledTimes(1); // unchanged
    // The regression this proves: before the fix, allocation ran BEFORE the
    // idempotency check, so this would be 2 — a voucher number burned for a
    // journal that was never actually (re)posted, leaving a permanent gap
    // in the gapless sequence.
    expect(nextVoucherNoMock).toHaveBeenCalledTimes(1);
  });
});
