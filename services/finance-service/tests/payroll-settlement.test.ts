/**
 * BL-03 regression: payroll.run.disbursed → salary SETTLEMENT journal
 * (Dr net-salary-payable / Cr bank).
 *
 * Before this fix the GL consumer subscribed to "payroll.run.finalized" — a
 * topic no service ever emits (payroll emits payroll.run.disbursed) — so the
 * settlement leg never posted and the net-payable liability never cleared.
 * This test FAILS on the old code (no subscription fires, no journal inserted)
 * and PASSES with the fix.
 *
 * Uses vi.mock to stub DB, outbox, and repos — no live database required
 * (same harness style as integration-procurement-bill.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

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

const {
  mockTx,
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
  insertJournalMock,
  insertJournalLineMock,
  insertLedgerLineMock,
  findHeadByCodeTxMock,
} = vi.hoisted(() => {
  const _mockTx = { execute: vi.fn(async () => []) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: vi.fn(async () => undefined) as any,
    markProcessedMock: vi.fn(async () => true) as any,
    insertJournalMock: vi.fn(async () => undefined) as any,
    insertJournalLineMock: vi.fn(async () => undefined) as any,
    insertLedgerLineMock: vi.fn(async () => undefined) as any,
    findHeadByCodeTxMock: vi.fn(async (_tx: unknown, _tenantId: string, code: string) => ({
      id: `head-uuid-${code}`, code, name: `Head ${code}`,
    })) as any,
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
  },
}));
vi.mock("../src/modules/gl/repo.js", () => ({
  insertJournal: (...args: any[]) => insertJournalMock(...args),
  insertJournalLine: (...args: any[]) => insertJournalLineMock(...args),
  insertLedgerLine: (...args: any[]) => insertLedgerLineMock(...args),
  findJournalById: vi.fn(async () => null),
  findJournalByIdTx: vi.fn(async () => null),
  markJournalReversed: vi.fn(async () => undefined),
  resolveHeadId: vi.fn(async () => "head-uuid"),
  getLedgerLines: vi.fn(async () => []),
  getTrialBalance: vi.fn(async () => []),
  listJournalsByTenant: vi.fn(async () => []),
  getTrialBalanceByPeriod: vi.fn(async () => []),
}));
vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: (...args: any[]) => findHeadByCodeTxMock(...args),
  findHeadByIdTx: vi.fn(async () => ({ id: "head-uuid", code: "0000", name: "Head" })),
}));
// gl/consumer.ts's postJournal() imports getPeriodStatusTx from
// period-close/repo.js (a tx-scoped read), NOT getPeriodStatus from
// period-close/routes.js. Mocking routes.js here mocked a module the
// production code path never touches, so the real getPeriodStatusTx ran
// against mockTx (which only implements .execute, no .select) and threw
// "tx.select is not a function" before insertJournal was ever reached.
vi.mock("../src/modules/period-close/repo.js", () => ({
  getPeriodStatusTx: vi.fn(async () => "open"),
}));
vi.mock("../src/modules/hoa/voucher.js", () => ({
  nextVoucherNo: vi.fn(async () => "AUTO/0001"),
  fyFromDate: vi.fn(() => "2026-27"),
}));
vi.mock("../src/modules/org-structure/domain.js", () => ({
  validateOrgAssignment: vi.fn(async () => undefined),
}));

import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const ACTOR = "bbbbbbbb-0000-0000-0000-000000000001";

describe("BL-03: payroll.run.disbursed → settlement journal", () => {
  let queue: TestMemoryQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new TestMemoryQueue();
    registerGlConsumers(queue as any);
  });

  it("subscribes to payroll.run.disbursed (the topic payroll actually emits)", () => {
    expect(CONSUMED_EVENTS.payrollRunDisbursed).toBe("payroll.run.disbursed");
  });

  it("posts a balanced Dr net-payable / Cr bank journal on disbursement", async () => {
    const runId = randomUUID();
    await queue.publish(CONSUMED_EVENTS.payrollRunDisbursed, {
      tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(),
      payload: { runId, month: "2026-06", totalNetMinor: "123450000" }, // ₹12,34,500.00
    });

    // Head codes resolved against the per-tenant COA
    const codesLookedUp = findHeadByCodeTxMock.mock.calls.map((c: any[]) => c[2]);
    expect(codesLookedUp).toContain("2101"); // net salary payable (default)
    expect(codesLookedUp).toContain("1101"); // bank (default)

    // A journal was inserted with the settlement type and balanced legs
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
    const journal = insertJournalMock.mock.calls[0][1];
    expect(journal.type).toBe("payroll_settlement");
    expect(String(journal.voucherNo)).toMatch(/^PAYSTL\/2026-06\//);
    const lines = journal.lines as Array<{ debitMinor: string; creditMinor: string }>;
    const totalDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(123450000n);
    expect(totalDr).toBe(totalCr);
  });

  it("is idempotent: a zero-net run posts nothing", async () => {
    await queue.publish(CONSUMED_EVENTS.payrollRunDisbursed, {
      tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(),
      payload: { runId: randomUUID(), month: "2026-06", totalNetMinor: "0" },
    });
    expect(insertJournalMock).not.toHaveBeenCalled();
  });

  it("emits finance.gl.rejected when a head code is missing from the COA", async () => {
    findHeadByCodeTxMock.mockResolvedValueOnce(null); // first lookup (payable) fails
    await queue.publish(CONSUMED_EVENTS.payrollRunDisbursed, {
      tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(),
      payload: { runId: randomUUID(), month: "2026-06", totalNetMinor: "500000" },
    });
    expect(insertJournalMock).not.toHaveBeenCalled();
    const rejected = enqueueMock.mock.calls.find((c: any[]) => c[1]?.topic === "finance.gl.rejected");
    expect(rejected).toBeTruthy();
  });
});
