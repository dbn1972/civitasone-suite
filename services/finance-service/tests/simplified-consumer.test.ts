/**
 * Simplified consumer tests — recordIncome, recordExpense,
 * recordPaymentReceived, recordPaymentMade, seedChart.
 *
 * DOM-010 follow-up: an independent review found that simplified/consumer.ts
 * was a second, complete, parallel journal-posting path that inserted
 * straight into finance_journals with NONE of gl/consumer.ts's three DOM-010
 * guards (leaf-account check, period-status check, gapless voucher
 * allocation ordered after the idempotency check). postSimplifiedJournal in
 * the consumer now applies the same three guards against simplified's own
 * chart of accounts (simplified.accounts, not gl.finance_heads — see the
 * module comment in consumer.ts for why the two charts can't share a
 * resolver). The "DOM-010 follow-up guards" block below mirrors
 * tests/dom-010-gl-guards.test.ts's REGRESSION-style assertions for all four
 * call sites; the harness (TestMemoryQueue) is copied from that file too,
 * because the real MemoryQueue's retry/backoff/DLQ semantics swallow handler
 * rejections instead of propagating them to publish() — unsuitable for
 * asserting "this command was rejected".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue (copied from tests/dom-010-gl-guards.test.ts
// so a rejected handler propagates synchronously to publish() — the real
// MemoryQueue's retry/backoff/DLQ semantics are unsuitable for REGRESSION
// tests that assert a command was rejected).
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
  mockTx, dbTransactionFn, enqueuedMessages,
  insertJournalMock, insertJournalLineMock, insertTransactionMock,
  markProcessedMock, findJournalByIdTxMock, findAccountByCodeTxMock,
  getPeriodStatusTxMock, nextVoucherNoMock, fyFromDateMock,
} = vi.hoisted(() => {
  const _insertJournalMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const _insertJournalLineMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const _insertTransactionMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  // tx.insert must return different chains based on which table is passed
  const _mockTx = {
    insert: vi.fn((table: any) => {
      if (table?._?.includes?.("journal_lines") || table?._name === "finance_journal_lines") return _insertJournalLineMock();
      if (table?._?.includes?.("journal") || table?._name === "finance_journals") return _insertJournalMock();
      // default — simplified_transactions
      return _insertTransactionMock();
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages,
    insertJournalMock: _insertJournalMock, insertJournalLineMock: _insertJournalLineMock, insertTransactionMock: _insertTransactionMock,
    markProcessedMock: vi.fn(async () => true) as any,
    findJournalByIdTxMock: vi.fn(async () => null) as any,
    findAccountByCodeTxMock: vi.fn() as any,
    getPeriodStatusTxMock: vi.fn(async () => "open") as any,
    nextVoucherNoMock: vi.fn(async () => ({ voucherNo: "SI/2026-27/000001", seq: 1 })) as any,
    fyFromDateMock: vi.fn(() => "2026-27") as any,
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));
vi.mock("../src/modules/gl/schema.js", () => ({
  financeJournals: { _name: "finance_journals" },
  financeJournalLines: { _name: "finance_journal_lines" },
}));
vi.mock("../src/modules/gl/repo.js", () => ({
  findJournalByIdTx: (...args: any[]) => findJournalByIdTxMock(...args),
}));
vi.mock("../src/modules/period-close/repo.js", () => ({
  getPeriodStatusTx: (...args: any[]) => getPeriodStatusTxMock(...args),
}));
vi.mock("../src/modules/hoa/voucher.js", () => ({
  nextVoucherNo: (...args: any[]) => nextVoucherNoMock(...args),
  fyFromDate: (...args: any[]) => fyFromDateMock(...args),
}));
vi.mock("../src/modules/simplified/schema.js", () => ({
  simplifiedTransactions: { _name: "simplified_transactions" },
}));
vi.mock("../src/modules/simplified/repo.js", () => ({
  findAccountByCodeTx: (...args: any[]) => findAccountByCodeTxMock(...args),
}));
// gl/domain.js (DomainError, assertJournalBalances) is intentionally left
// unmocked — pure, dependency-free logic, exactly like dom-010-gl-guards.test.ts.

import { registerSimplifiedConsumers } from "../src/modules/simplified/consumer.js";
import { SIMPLIFIED_COMMANDS, SIMPLIFIED_EVENTS } from "../src/modules/simplified/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerSimplifiedConsumers(q as any);
  await q.start();
  return q;
}

/** account codes each command's auto-generated journal touches, and the one
 *  used for the leaf-account REGRESSION test below. */
const COMMAND_CASES = [
  {
    key: "recordIncome", topic: SIMPLIFIED_COMMANDS.recordIncome, leafTestCode: "4001",
    buildPayload: (id: string) => ({
      id, tenantId: TENANT, actorId: ACTOR,
      amountMinor: "100000", gstMinor: "18000", totalMinor: "118000",
      customerName: "ACME Corp", incomeType: "sales", gstRate: 18,
      postingDate: "2026-06-01",
    }),
  },
  {
    key: "recordExpense", topic: SIMPLIFIED_COMMANDS.recordExpense, leafTestCode: "5006",
    buildPayload: (id: string) => ({
      id, tenantId: TENANT, actorId: ACTOR,
      amountMinor: "50000", gstMinor: "9000", totalMinor: "59000",
      category: "office_supplies", vendorName: "Stationery Shop", gstRate: 18,
      postingDate: "2026-06-02",
    }),
  },
  {
    key: "recordPaymentReceived", topic: SIMPLIFIED_COMMANDS.recordPaymentReceived, leafTestCode: "1002",
    buildPayload: (id: string) => ({
      id, tenantId: TENANT, actorId: ACTOR,
      amountMinor: "100000", customerName: "Client ABC",
      postingDate: "2026-06-03",
    }),
  },
  {
    key: "recordPaymentMade", topic: SIMPLIFIED_COMMANDS.recordPaymentMade, leafTestCode: "2001",
    buildPayload: (id: string) => ({
      id, tenantId: TENANT, actorId: ACTOR,
      amountMinor: "75000", vendorName: "Supplier XYZ",
      postingDate: "2026-06-04",
    }),
  },
] as const;

function defaultAccount(code: string) {
  return {
    id: randomUUID(), tenantId: TENANT, code,
    name: `Account ${code}`,
    category: code.startsWith("4") ? "income" : code.startsWith("5") ? "expense" :
      code.startsWith("1") ? "asset" : "liability",
    parentCode: null, isGroup: false, active: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  markProcessedMock.mockResolvedValue(true);
  findJournalByIdTxMock.mockResolvedValue(null); // default: not yet posted
  findAccountByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => defaultAccount(code));
  getPeriodStatusTxMock.mockResolvedValue("open"); // default: period is genuinely open
  nextVoucherNoMock.mockImplementation(async () => ({ voucherNo: "SI/2026-27/000001", seq: 1 }));
  fyFromDateMock.mockImplementation(() => "2026-27");
});

describe("simplified recordIncome command", () => {
  it("creates GL journal + simplified transaction + audit event", async () => {
    const q = await buildQueue();
    await q.publish(SIMPLIFIED_COMMANDS.recordIncome, makeMsg(SIMPLIFIED_COMMANDS.recordIncome, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "100000", gstMinor: "18000", totalMinor: "118000",
      customerName: "ACME Corp", incomeType: "sales", gstRate: 18,
      postingDate: "2026-06-01",
    }));
    expect(mockTx.insert).toHaveBeenCalled();
    const evt = enqueuedMessages.find((m) => m.topic === "audit.event.record" || (m.payload as any)?.action === "simplified_record_income");
    expect(evt).toBeDefined();
    await q.stop();
  });
});

describe("simplified recordExpense command", () => {
  it("creates GL journal + simplified transaction for expense", async () => {
    const q = await buildQueue();
    await q.publish(SIMPLIFIED_COMMANDS.recordExpense, makeMsg(SIMPLIFIED_COMMANDS.recordExpense, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "50000", gstMinor: "9000", totalMinor: "59000",
      category: "office_supplies", vendorName: "Stationery Shop", gstRate: 18,
      postingDate: "2026-06-02",
    }));
    expect(mockTx.insert).toHaveBeenCalled();
    const evt = enqueuedMessages.find((m) => (m.payload as any)?.action === "simplified_record_expense");
    expect(evt).toBeDefined();
    await q.stop();
  });
});

describe("simplified recordPaymentReceived command", () => {
  it("records payment received and posts GL journal", async () => {
    const q = await buildQueue();
    await q.publish(SIMPLIFIED_COMMANDS.recordPaymentReceived, makeMsg(SIMPLIFIED_COMMANDS.recordPaymentReceived, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "100000", customerName: "Client ABC",
      postingDate: "2026-06-03",
    }));
    expect(mockTx.insert).toHaveBeenCalled();
    await q.stop();
  });
});

describe("simplified recordPaymentMade command", () => {
  it("records payment made and posts GL journal", async () => {
    const q = await buildQueue();
    await q.publish(SIMPLIFIED_COMMANDS.recordPaymentMade, makeMsg(SIMPLIFIED_COMMANDS.recordPaymentMade, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "75000", vendorName: "Supplier XYZ",
      postingDate: "2026-06-04",
    }));
    expect(mockTx.insert).toHaveBeenCalled();
    await q.stop();
  });
});

describe("simplified seedChart command", () => {
  it("seeds the simplified chart of accounts", async () => {
    const q = await buildQueue();
    await q.publish(SIMPLIFIED_COMMANDS.seedChart, makeMsg(SIMPLIFIED_COMMANDS.seedChart, {
      tenantId: TENANT, actorId: ACTOR,
    }));
    // seedChart has no registered subscriber on this consumer (registration-only
    // topic / handled elsewhere) — the important thing is no error thrown.
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
// DOM-010 follow-up: the same three guards gl/consumer.ts's postJournal
// enforces, now enforced by postSimplifiedJournal for all four simplified
// call sites. Mirrors tests/dom-010-gl-guards.test.ts's REGRESSION structure.
// ---------------------------------------------------------------------------
describe.each(COMMAND_CASES)("DOM-010 follow-up guards — $key", ({ key, topic, leafTestCode, buildPayload }) => {
  it("REGRESSION: rejects posting when a line's account is a non-leaf (group) account", async () => {
    findAccountByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => ({
      ...defaultAccount(code),
      isGroup: code === leafTestCode,
    }));

    const q = await buildQueue();
    const payload = buildPayload(randomUUID());
    await expect(q.publish(topic, makeMsg(topic, payload))).rejects.toThrow(/NOT_LEAF_ACCOUNT/);

    expect(insertJournalMock).not.toHaveBeenCalled();
    expect(insertTransactionMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: rejects posting when a line's account code is not in the simplified chart at all", async () => {
    findAccountByCodeTxMock.mockResolvedValue(null); // tenant's chart was never seeded

    const q = await buildQueue();
    const payload = buildPayload(randomUUID());
    await expect(q.publish(topic, makeMsg(topic, payload))).rejects.toThrow(/UNKNOWN_SIMPLIFIED_ACCOUNT_CODE/);

    expect(insertJournalMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: rejects posting into a period the system does not recognise", async () => {
    getPeriodStatusTxMock.mockResolvedValue("unknown");

    const q = await buildQueue();
    const payload = buildPayload(randomUUID());
    await expect(q.publish(topic, makeMsg(topic, payload))).rejects.toThrow(/PERIOD_UNKNOWN/);

    expect(insertJournalMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: rejects posting into a hard-closed period", async () => {
    getPeriodStatusTxMock.mockResolvedValue("hard_close");

    const q = await buildQueue();
    const payload = buildPayload(randomUUID());
    await expect(q.publish(topic, makeMsg(topic, payload))).rejects.toThrow(/PERIOD_CLOSED/);

    expect(insertJournalMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: a retried/redelivered duplicate request does not burn a voucher number or double-post", async () => {
    const q = await buildQueue();
    const payload = buildPayload(randomUUID()); // fixed journal id, reused for both publishes

    // First delivery: journal does not exist yet — voucher IS allocated and
    // the journal IS posted.
    findJournalByIdTxMock.mockResolvedValueOnce(null);
    await q.publish(topic, makeMsg(topic, payload));
    expect(nextVoucherNoMock).toHaveBeenCalledTimes(1);
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
    expect(insertTransactionMock).toHaveBeenCalledTimes(1);

    // Retried/redelivered: identical payload (same journal id) republished
    // under a brand-new messageId — exactly what a client retry after a
    // timeout looks like. The journal now exists, so the idempotency
    // short-circuit must fire BEFORE voucher allocation is ever reached, and
    // before the simplified_transactions / audit side effects too.
    findJournalByIdTxMock.mockResolvedValue({ id: payload.id });
    await q.publish(topic, makeMsg(topic, payload));

    expect(nextVoucherNoMock).toHaveBeenCalledTimes(1); // unchanged — no gap burned
    expect(insertJournalMock).toHaveBeenCalledTimes(1); // unchanged — no double-post
    expect(insertTransactionMock).toHaveBeenCalledTimes(1); // unchanged — no duplicate user-facing record
  });

  it("posts normally in the common case — no regression for well-formed input", async () => {
    const q = await buildQueue();
    const payload = buildPayload(randomUUID());
    await q.publish(topic, makeMsg(topic, payload));
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
    expect(insertTransactionMock).toHaveBeenCalledTimes(1);
  });
});
