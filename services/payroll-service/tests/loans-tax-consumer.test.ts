/**
 * Payroll loans + tax consumer mock tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertLoanMock, updateLoanMock, findLoanByIdTxMock } = vi.hoisted(() => {
  const _insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) });
  const _mockTx = { insert: _insertMock };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages,
    insertLoanMock: vi.fn(async () => undefined),
    updateLoanMock: vi.fn(async () => undefined),
    findLoanByIdTxMock: vi.fn(async () => ({ id: "l1", employeeId: "e1", principalMinor: 500000n })),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn, execute: vi.fn(async () => []) } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("../src/modules/loans/repo.js", () => ({
  insertLoan: (...a: any[]) => insertLoanMock(...a),
  updateLoan: (...a: any[]) => updateLoanMock(...a),
  findLoanByIdTx: (...a: any[]) => findLoanByIdTxMock(...a),
}));
vi.mock("../src/modules/tax/schema.js", () => ({
  taxDeclarations: { tenantId: "tid", employeeId: "eid", fy: "fy" },
}));

import { registerLoansConsumers } from "../src/modules/loans/consumer.js";
import { registerTaxConsumers } from "../src/modules/tax/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => { vi.clearAllMocks(); enqueuedMessages.length = 0; dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); }); });

describe("loanCreate command", () => {
  it("inserts loan with status 'applied'", async () => {
    const q = new MemoryQueue(); registerLoansConsumers(q); await q.start();
    await q.publish(COMMANDS.loanCreate, makeMsg(COMMANDS.loanCreate, {
      id: randomUUID(), tenantId: TENANT, loanNo: "LN/001", employeeId: randomUUID(),
      loanType: "personal", principalMinor: 5000000, emiMinor: 500000,
      tenureMonths: 12, interestRatePct: 8, currency: "INR",
    }));
    await settle();
    expect(insertLoanMock).toHaveBeenCalledOnce();
    const row = insertLoanMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("applied");
    expect(row.principalMinor).toBe(5000000n);
    await q.stop();
  });
});

describe("loanDisburse command", () => {
  it("updates loan to 'disbursed' and emits event", async () => {
    const q = new MemoryQueue(); registerLoansConsumers(q); await q.start();
    await q.publish(COMMANDS.loanDisburse, makeMsg(COMMANDS.loanDisburse, {
      id: "l1", tenantId: TENANT,
    }));
    await settle();
    expect(updateLoanMock).toHaveBeenCalledOnce();
    const [, , patch] = updateLoanMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.status).toBe("disbursed");
    const evt = enqueuedMessages.find(m => m.topic === EVENTS.loanDisbursed);
    expect(evt).toBeDefined();
    await q.stop();
  });
});

describe("taxDeclarationSubmit command", () => {
  it("upserts tax declaration with status 'submitted'", async () => {
    const q = new MemoryQueue(); registerTaxConsumers(q); await q.start();
    await q.publish(COMMANDS.taxDeclarationSubmit, makeMsg(COMMANDS.taxDeclarationSubmit, {
      id: randomUUID(), tenantId: TENANT, employeeId: randomUUID(),
      fy: "2025-26", regime: "new", section80c: 150000, section80d: 25000,
      otherDeductions: 0, rentPaidMinor: 240000,
    }));
    await settle();
    expect(mockTx.insert).toHaveBeenCalled();
    // Audit emitted
    const audit = enqueuedMessages.find(m => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    await q.stop();
  });
});
