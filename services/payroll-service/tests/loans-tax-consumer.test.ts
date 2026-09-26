/**
 * Payroll loans + tax consumer mock tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertLoanMock, updateLoanMock, findLoanByIdTxMock, findLoansByEmployeeTxMock, findLatestGrossMinorForEmployeeTxMock } = vi.hoisted(() => {
  const _insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) });
  // BUG-1 (payroll loans EMI cap): consumer.ts now runs
  // `tx.execute(sql\`SELECT pg_advisory_xact_lock(...)\`)` before insertLoan,
  // to serialize the combined-EMI re-check against concurrent createLoan
  // commands for the same employee — see loans/consumer.ts and policy.ts.
  // mockTx needs an `execute` of its own for that call to resolve.
  const _mockTx = { insert: _insertMock, execute: vi.fn(async () => []) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages,
    insertLoanMock: vi.fn(async () => undefined),
    updateLoanMock: vi.fn(async () => undefined),
    findLoanByIdTxMock: vi.fn(async () => ({ id: "l1", employeeId: "e1", principalMinor: 500000n })),
    // BUG-1: no existing loans / no payroll history for this test's employee
    // — decideCombinedEmiCap (policy.ts) allows unconditionally when gross is
    // null, so this loan is approved exactly as it was before the EMI cap was
    // added. See a dedicated cap-rejection case below for the opposite path.
    findLoansByEmployeeTxMock: vi.fn(async () => [] as Array<{ id: string; status: string; emiMinor: bigint }>),
    findLatestGrossMinorForEmployeeTxMock: vi.fn(async () => null as bigint | null),
  };
});

vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn, execute: vi.fn(async () => []) } }));
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
  findLoansByEmployeeTx: (...a: any[]) => findLoansByEmployeeTxMock(...a),
  findLatestGrossMinorForEmployeeTx: (...a: any[]) => findLatestGrossMinorForEmployeeTxMock(...a),
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

describe("loanCreate command — EMI cap (BUG-1)", () => {
  it("rejects (does not insert) when combined EMI would exceed the cap, and logs the rejection (BUG-2)", async () => {
    findLoansByEmployeeTxMock.mockResolvedValueOnce([
      { id: "existing-loan-1", status: "disbursed", emiMinor: 400_000n },
    ]);
    // gross ₹10,000 (paise) -> 50% placeholder cap (policy.ts) = 500,000 paise.
    // existing 400,000 + new 200,000 = 600,000 > 500,000 cap.
    findLatestGrossMinorForEmployeeTxMock.mockResolvedValueOnce(1_000_000n);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const q = new MemoryQueue(); registerLoansConsumers(q); await q.start();
    await q.publish(COMMANDS.loanCreate, makeMsg(COMMANDS.loanCreate, {
      id: randomUUID(), tenantId: TENANT, loanNo: "LN/002", employeeId: randomUUID(),
      loanType: "personal", principalMinor: 5000000, emiMinor: 200_000,
      tenureMonths: 12, interestRatePct: 8, currency: "INR",
    }));
    await settle();

    expect(insertLoanMock).not.toHaveBeenCalled();
    // BUG-2: the rejection must be logged, not silently dropped.
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(logged.some((line) => line.includes("queue_consumer_error"))).toBe(true);
    expect(logged.some((line) => line.includes("LOAN_EMI_CAP_EXCEEDED"))).toBe(true);

    await q.stop();
    errorSpy.mockRestore();
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
