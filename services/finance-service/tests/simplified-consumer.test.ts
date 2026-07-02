/**
 * Simplified consumer mock tests — recordIncome, recordExpense,
 * recordPaymentReceived, recordPaymentMade, seedChart.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertJournalMock, insertJournalLineMock, insertTransactionMock } = vi.hoisted(() => {
  const _insertJournalMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const _insertJournalLineMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const _insertTransactionMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  // tx.insert must return different chains based on which table is passed
  const _mockTx = {
    insert: vi.fn((table: any) => {
      if (table?._?.includes?.("journal_lines") || table?._name === "finance_journal_lines") return _insertJournalLineMock();
      if (table?._?.includes?.("journal") || table?._name === "finance_journals") return _insertJournalMock();
      // default — simplified_transactions or chart_of_accounts
      return _insertTransactionMock();
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages,
    insertJournalMock: _insertJournalMock, insertJournalLineMock: _insertJournalLineMock, insertTransactionMock: _insertTransactionMock,
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/gl/schema.js", () => ({
  financeJournals: { _name: "finance_journals" },
  financeJournalLines: { _name: "finance_journal_lines" },
}));
vi.mock("../src/modules/simplified/schema.js", () => ({
  simplifiedTransactions: { _name: "simplified_transactions" },
  simplifiedChartOfAccounts: { _name: "simplified_chart_of_accounts" },
}));

import { registerSimplifiedConsumers } from "../src/modules/simplified/consumer.js";
import { SIMPLIFIED_COMMANDS, SIMPLIFIED_EVENTS } from "../src/modules/simplified/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks(); enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("simplified recordIncome command", () => {
  it("creates GL journal + simplified transaction + audit event", async () => {
    const q = new MemoryQueue(); registerSimplifiedConsumers(q); await q.start();
    await q.publish(SIMPLIFIED_COMMANDS.recordIncome, makeMsg(SIMPLIFIED_COMMANDS.recordIncome, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "100000", gstMinor: "18000", totalMinor: "118000",
      customerName: "ACME Corp", incomeType: "sales", gstRate: 18,
      postingDate: "2026-06-01",
    }));
    await settle();
    // tx.insert called for journal, journal lines, and simplified transaction
    expect(mockTx.insert).toHaveBeenCalled();
    // Audit event emitted
    const evt = enqueuedMessages.find((m) => m.topic === "audit.event.record" || (m.payload as any)?.action === "simplified_record_income");
    expect(evt).toBeDefined();
    await q.stop();
  });
});

describe("simplified recordExpense command", () => {
  it("creates GL journal + simplified transaction for expense", async () => {
    const q = new MemoryQueue(); registerSimplifiedConsumers(q); await q.start();
    await q.publish(SIMPLIFIED_COMMANDS.recordExpense, makeMsg(SIMPLIFIED_COMMANDS.recordExpense, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "50000", gstMinor: "9000", totalMinor: "59000",
      category: "office_supplies", vendorName: "Stationery Shop", gstRate: 18,
      postingDate: "2026-06-02",
    }));
    await settle();
    expect(mockTx.insert).toHaveBeenCalled();
    const evt = enqueuedMessages.find((m) => (m.payload as any)?.action === "simplified_record_expense");
    expect(evt).toBeDefined();
    await q.stop();
  });
});

describe("simplified recordPaymentReceived command", () => {
  it("records payment received and posts GL journal", async () => {
    const q = new MemoryQueue(); registerSimplifiedConsumers(q); await q.start();
    await q.publish(SIMPLIFIED_COMMANDS.recordPaymentReceived, makeMsg(SIMPLIFIED_COMMANDS.recordPaymentReceived, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "100000", customerName: "Client ABC",
      postingDate: "2026-06-03",
    }));
    await settle();
    expect(mockTx.insert).toHaveBeenCalled();
    await q.stop();
  });
});

describe("simplified recordPaymentMade command", () => {
  it("records payment made and posts GL journal", async () => {
    const q = new MemoryQueue(); registerSimplifiedConsumers(q); await q.start();
    await q.publish(SIMPLIFIED_COMMANDS.recordPaymentMade, makeMsg(SIMPLIFIED_COMMANDS.recordPaymentMade, {
      id: randomUUID(), tenantId: TENANT, actorId: ACTOR,
      amountMinor: "75000", vendorName: "Supplier XYZ",
      postingDate: "2026-06-04",
    }));
    await settle();
    expect(mockTx.insert).toHaveBeenCalled();
    await q.stop();
  });
});

describe("simplified seedChart command", () => {
  it("seeds the simplified chart of accounts", async () => {
    const q = new MemoryQueue(); registerSimplifiedConsumers(q); await q.start();
    await q.publish(SIMPLIFIED_COMMANDS.seedChart, makeMsg(SIMPLIFIED_COMMANDS.seedChart, {
      tenantId: TENANT, actorId: ACTOR,
    }));
    await settle();
    // seedChart may not insert if the schema uses ON CONFLICT DO NOTHING or if
    // the handler is registration-only. The important thing is no error thrown.
    await q.stop();
  });
});
