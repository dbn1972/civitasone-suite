/**
 * fp-assets-01: an unknown GL account code is a NON-RETRYABLE failure that the producer is told about.
 *  - the posting transaction rolls back, nothing is posted;
 *  - finance.gl.rejected is emitted (journalId + reason) so asset-service can show the journal as not posted;
 *  - the error is alertable (captureError tagged GL_UNKNOWN_ACCOUNT_CODE) and is a NonRetryableError (dead-letters, no retry loop).
 * Harness mirrors tests/dom-010-gl-guards.test.ts (mocked-DB unit style).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";
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
  scopedRead: dbTransactionFn,
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
  validateOrgAssignmentTx: vi.fn(async () => undefined),
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
import { registerGlConsumers, UnknownAccountCodeError } from "../src/modules/gl/consumer.js";
import { NonRetryableError } from "@civitasone/queue";
import * as observability from "@civitasone/observability";
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
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  hasChildHeadsTxMock.mockResolvedValue(false);
  getPeriodStatusTxMock.mockResolvedValue("open");
  findBudgetTxMock.mockResolvedValue(null);
  nextVoucherNoMock.mockImplementation(async () => ({ voucherNo: "JV/2025-26/000001", seq: 1 }));
});

describe("unknown GL account code (fp-assets-01)", () => {
  const MISSING = "2300";
  const unknownHead = () =>
    findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) =>
      code === MISSING ? null : { id: fakeHeadUuid(code), code, name: `Head ${code}`, tenantId: TENANT });

  it("throws a NonRetryableError, posts nothing, tells the producer via finance.gl.rejected and raises an alertable error", async () => {
    unknownHead();
    const capture = vi.spyOn(observability, "captureError").mockImplementation(() => undefined);
    const payload = journalPayload({ type: "lease_recognition", voucherNo: "LEASE/2026-04-01/abcd1234" });
    (payload.lines as Array<Record<string, unknown>>)[1]!.accountCode = MISSING;
    const q = await buildQueue();
    const err = await q.publish(COMMANDS.journalPost, makeMsg(payload)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownAccountCodeError);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(insertJournalMock).not.toHaveBeenCalled();
    expect(insertLedgerLineMock).not.toHaveBeenCalled();

    const rejected = enqueueMock.mock.calls.filter((c: any[]) => c[1]?.topic === "finance.gl.rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]![1].payload).toMatchObject({ journalId: payload.id, accountCode: MISSING });
    expect(rejected[0]![1].payload.reason).toMatch(/UNKNOWN_ACCOUNT_CODE/);
    expect(enqueueMock.mock.calls.some((c: any[]) => c[1]?.topic === "finance.gl.posted")).toBe(false);
    expect(capture).toHaveBeenCalledWith(expect.any(UnknownAccountCodeError), expect.objectContaining({ alert: "GL_UNKNOWN_ACCOUNT_CODE", accountCode: MISSING, journalId: payload.id }));
  });

  it("a journal whose heads all exist still posts and emits finance.gl.posted (no regression)", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.journalPost, makeMsg(journalPayload()));
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls.some((c: any[]) => c[1]?.topic === "finance.gl.posted")).toBe(true);
    expect(enqueueMock.mock.calls.some((c: any[]) => c[1]?.topic === "finance.gl.rejected")).toBe(false);
  });
});
