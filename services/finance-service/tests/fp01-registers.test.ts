/**
 * fp-finance-01: register capabilities (real Postgres).
 *
 *  - GAP-FINANCE-DEBT-01                     lender/terms, EMI schedule, instalment payment
 *  - GAP-FINANCE-EXPENDITURE-GUARANTEES-01/-02  validity, beneficiary, linked ref
 *  - GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-01 / NEW-01 / NEW-02
 *                                            declaration, grantee, over-claim, verify / return / resubmit
 *  - GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01 sanctioning authority + reason
 *  - GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01  direct approve refused while an eOffice file is in flight
 *  - GAP-FINANCE-BUDGET-FUND-RELEASES-01     office directory names on distributions
 *  - GAP-FINANCE-CONFIG-02                   audited bank-account reveal
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { setFinanceSettings, clearFinanceSettings, setDebtHeads } from "./_finance-settings.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { registerTreasuryRegisterConsumers } from "../src/modules/treasury/register-consumer.js";
import { registerUCLifecycleConsumers } from "../src/modules/payments/uc-consumer.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { registerEOfficeDecisionConsumers } from "../src/modules/budget/eoffice-consumer.js";
import { registerOfficeConsumers } from "../src/modules/budget/office-consumer.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { registerApprovalsConsumers } from "../src/modules/approvals/consumer.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = "00000000-aaaa-4000-8000-0000000fc101";
const CHECKER = "00000000-aaaa-4000-8000-0000000fc102";
const CHECKER2 = "00000000-aaaa-4000-8000-0000000fc103";

const as = (sub: string, roles = ["finance_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: `s-${sub.slice(-3)}` }, SECRET)}`,
});

type Sent = { topic: string; env: Record<string, unknown> };
let sent: Sent[] = [];
function capture() {
  sent = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, env: any) => { sent.push({ topic, env }); return undefined as never; });
}
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
async function deliver(): Promise<MemoryQueue> {
  const q = tenantWrappedQueue();
  registerTreasuryRegisterConsumers(q);
  registerUCLifecycleConsumers(q);
  registerPaymentsConsumers(q);
  registerBudgetConsumers(q);
  registerEOfficeDecisionConsumers(q);
  registerOfficeConsumers(q);
  registerMastersConsumers(q);
  registerApprovalsConsumers(q);
  registerGlConsumers(q);
  await q.start();
  const batch = sent;
  sent = [];
  for (const b of batch) await q.publish(b.topic, b.env as never);
  await q.drain();
  return q;
}
/** Re-publish a captured envelope under a different actor/message id (a second checker acting at the same time). */
function asActor(s: Sent, actorId: string): Sent {
  return { topic: s.topic, env: { ...s.env, actorId, messageId: randomUUID() } };
}
async function inject(method: "GET" | "POST" | "PATCH" | "PUT", url: string, headers: Record<string, string>, payload?: unknown) {
  const app = await buildApp();
  try {
    return await app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  } finally { await app.close(); }
}
async function rows<T = Record<string, any>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r: any = await scoped(TENANT, (tx) => tx.execute(query));
  return (Array.isArray(r) ? r : r.rows ?? []) as T[];
}
const audits = (action: string) => rows<{ payload: any }>(
  sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'action' = ${action}`);

const SANCTION_ID = "bbbbbbbb-6666-4000-8000-0000000fc101";
const HEAD_ID = "bbbbbbbb-6666-4000-8000-0000000fc102";
const SANCTION_EFILE = "bbbbbbbb-6666-4000-8000-0000000fc103";
const H_BANK = "bbbbbbbb-7777-4000-8000-0000000fc101";
const H_LOAN = "bbbbbbbb-7777-4000-8000-0000000fc102";
const H_INT = "bbbbbbbb-7777-4000-8000-0000000fc103";
const H_EXP2 = "bbbbbbbb-7777-4000-8000-0000000fc104";

async function cleanup() {
  await clearFinanceSettings(TENANT);
  for (const t of ["treasury.finance_debt_emi", "treasury.finance_debt", "treasury.finance_guarantees", "payments.finance_uc",
    "payments.finance_advances", "budget.finance_sanctions", "budget.finance_offices", "budget.finance_allocation_distributions",
    "payments.finance_bank_accounts", "budget.finance_heads"]) {
    await scoped(TENANT, (tx) => tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'::uuid`)));
  }
}
beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: H_BANK, tenantId: TENANT, code: "FP1-BANK", name: "Bank", level: 1, classification: "asset", createdBy: MAKER, updatedBy: MAKER },
    { id: H_LOAN, tenantId: TENANT, code: "FP1-LOAN", name: "Loans payable", level: 1, classification: "liability", createdBy: MAKER, updatedBy: MAKER },
    { id: H_INT, tenantId: TENANT, code: "FP1-INT", name: "Interest expense", level: 1, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    { id: H_EXP2, tenantId: TENANT, code: "FP1-EXP2", name: "Other expense", level: 1, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
  ]));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO budget.finance_sanctions (id, tenant_id, sanction_no, purpose, head_id, amount_minor, status, created_by, updated_by)
    VALUES (${SANCTION_ID}::uuid, ${TENANT}::uuid, 'SN-FP1-001', 'Roads grant', ${HEAD_ID}::uuid, 100000000, 'approved', ${MAKER}::uuid, ${MAKER}::uuid),
           (${SANCTION_EFILE}::uuid, ${TENANT}::uuid, 'SN-FP1-002', 'Bridges', ${HEAD_ID}::uuid, 5000000, 'pending_approval', ${MAKER}::uuid, ${MAKER}::uuid)`));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("debt register: lender, EMI schedule, instalment payment (GAP-FINANCE-DEBT-01)", () => {
  let debtId = "";
  const body = {
    instrument: "State Development Loan 2031", source: "market", lender: "National Bank for Agriculture",
    principalMinor: "120000000", interestRateBps: 850, tenureMonths: 12, firstEmiDate: "2025-05-31",
  };

  it("rejects bad terms with a field-level 400 before anything is published", async () => {
    capture();
    const res = await inject("POST", "/v1/finance/debt", as(MAKER), { ...body, tenureMonths: 0 });
    expect(res.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
    const noLender = await inject("POST", "/v1/finance/debt", as(MAKER), { ...body, lender: "" });
    expect(noLender.statusCode).toBe(400);
    expect(noLender.json().fieldErrors.map((f: { field: string }) => f.field)).toContain("lender");
  });

  it("refuses to create a loan until the three GL heads are configured (409 GL_HEADS_NOT_CONFIGURED), then validates them", async () => {
    capture();
    const none = await inject("POST", "/v1/finance/debt", as(MAKER), body);
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe("GL_HEADS_NOT_CONFIGURED");
    expect(sent).toHaveLength(0);
    // settings PUT validates: wrong type / clash / unknown / incomplete
    const put = (changes: Record<string, unknown>) => inject("PUT", "/v1/finance/settings", as(MAKER), { ...changes, reason: "Configure debt GL heads" });
    expect((await put({ debtLoanLiabilityHeadId: H_LOAN })).json().code).toBe("GL_HEADS_INCOMPLETE");
    expect((await put({ debtLoanLiabilityHeadId: H_BANK, debtInterestExpenseHeadId: H_INT, debtBankHeadId: H_LOAN })).json().code).toBe("GL_HEAD_WRONG_TYPE");
    expect((await put({ debtLoanLiabilityHeadId: H_LOAN, debtInterestExpenseHeadId: H_INT, debtBankHeadId: randomUUID() })).json().code).toBe("GL_HEAD_NOT_FOUND");
    const ok = await put({ debtLoanLiabilityHeadId: H_LOAN, debtInterestExpenseHeadId: H_INT, debtBankHeadId: H_BANK });
    expect(ok.statusCode).toBe(202);
    await deliver();
    expect((await inject("GET", "/v1/finance/settings", as(MAKER))).json()).toMatchObject({ debtLoanLiabilityHeadId: H_LOAN, debtInterestExpenseHeadId: H_INT, debtBankHeadId: H_BANK });
  });

  it("two heads that are the same head clash", () => {
    return (async () => {
      const res = await inject("PUT", "/v1/finance/settings", as(MAKER), {
        debtLoanLiabilityHeadId: H_LOAN, debtInterestExpenseHeadId: H_INT, debtBankHeadId: H_LOAN, reason: "Configure debt GL heads",
      });
      expect(res.statusCode).toBe(400);
      expect(["GL_HEADS_CLASH", "GL_HEAD_WRONG_TYPE"]).toContain(res.json().code);
    })();
  });

  it("creates the loan and its full schedule; the list shows lender and outstanding principal; the receipt journal is requested", async () => {
    capture();
    const res = await inject("POST", "/v1/finance/debt", as(MAKER), body);
    expect(res.statusCode).toBe(202);
    debtId = res.json().id;
    await deliver();
    const list = await inject("GET", "/v1/finance/debt", as(MAKER, ["finance_officer"]));
    const row = (list.json() as Array<Record<string, any>>).find((r) => r.id === debtId)!;
    expect(row).toMatchObject({ lender: "National Bank for Agriculture", interestRateBps: 850, tenureMonths: 12, outstandingMinor: "120000000", maturity: "2026-04-30" });
    const detail = await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER, ["audit_officer"]));
    expect(detail.statusCode).toBe(200);
    const d = detail.json();
    expect(d.schedule).toHaveLength(12);
    expect(d.schedule.reduce((a: bigint, r: { principalMinor: string }) => a + BigInt(r.principalMinor), 0n)).toBe(120000000n);
    expect(d.schedule[0]).toMatchObject({ installmentNo: 1, dueDate: "2025-05-31", status: "due" });
    expect(d.schedule[1].dueDate).toBe("2025-06-30");
    expect((await audits("create_debt")).length).toBe(1);
    expect(d.receiptGlStatus).toMatch(/^(pending|posted)$/);
    const rec = await rows<{ payload: any }>(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = ${COMMANDS.journalPost} AND payload->>'type' = 'receipt'`);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.payload.lines).toEqual([
      expect.objectContaining({ accountCode: H_BANK, debitMinor: "120000000", creditMinor: "0" }),
      expect.objectContaining({ accountCode: H_LOAN, debitMinor: "0", creditMinor: "120000000" }),
    ]);
  });

  it("another tenant cannot read the loan", async () => {
    const res = await inject("GET", `/v1/finance/debt/${debtId}`, {
      authorization: `Bearer ${signToken({ sub: MAKER, tid: randomUUID(), roles: ["finance_admin"], sid: "sx" }, SECRET)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("instalments are paid in order, and paidOn is validated (not future, not before the loan)", async () => {
    capture();
    const skip = await inject("POST", `/v1/finance/debt/${debtId}/emi/3/pay`, as(MAKER), {});
    expect(skip.statusCode).toBe(409);
    expect(skip.json().code).toBe("EMI_OUT_OF_ORDER");
    const future = await inject("POST", `/v1/finance/debt/${debtId}/emi/1/pay`, as(MAKER), { paidOn: "2999-01-01" });
    expect(future.statusCode).toBe(400);
    expect(future.json().code).toBe("EMI_PAID_ON_FUTURE");
    const early = await inject("POST", `/v1/finance/debt/${debtId}/emi/1/pay`, as(MAKER), { paidOn: "2020-01-01" });
    expect(early.json().code).toBe("EMI_PAID_ON_BEFORE_LOAN");
    expect(sent).toHaveLength(0);
    // a hand-published out-of-order command is refused by the consumer too
    sent = [{ topic: COMMANDS.debtEmiPay, env: { messageId: randomUUID(), type: COMMANDS.debtEmiPay, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0", payload: { debtId, installmentNo: 3, tenantId: TENANT, paidOn: null, paymentRef: null } } }];
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
  });

  it("paying an instalment reduces the outstanding principal by that instalment's principal; paying it again is refused", async () => {
    capture();
    const before = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
    const res = await inject("POST", `/v1/finance/debt/${debtId}/emi/1/pay`, as(MAKER), { paidOn: "2025-05-31", paymentRef: "UTR123" });
    expect(res.statusCode).toBe(202);
    await deliver();
    const after = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
    expect(after.schedule[0]).toMatchObject({ status: "paid", paidOn: "2025-05-31", paymentRef: "UTR123" });
    expect(BigInt(before.outstandingMinor) - BigInt(after.outstandingMinor)).toBe(BigInt(before.schedule[0].principalMinor));
    // Books: Dr loan liability (principal) + Dr interest expense / Cr bank (total), one balanced journal
    const jr = await rows<{ payload: any }>(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = ${COMMANDS.journalPost} AND payload->>'type' = 'payment' AND payload->'lines'->0->>'narration' LIKE 'Loan instalment 1%'`);
    expect(jr).toHaveLength(1);
    const ls = jr[0]!.payload.lines as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
    expect(ls.map((l) => l.accountCode)).toEqual([H_LOAN, H_INT, H_BANK]);
    expect(ls.reduce((a, l) => a + BigInt(l.debitMinor), 0n)).toBe(ls.reduce((a, l) => a + BigInt(l.creditMinor), 0n));
    expect(ls[0]!.debitMinor).toBe(before.schedule[0].principalMinor);
    expect(ls[1]!.debitMinor).toBe(before.schedule[0].interestMinor);
    expect(after.schedule[0].glStatus).toMatch(/^(pending|posted)$/);
    const again = await inject("POST", `/v1/finance/debt/${debtId}/emi/1/pay`, as(MAKER), {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("EMI_ALREADY_PAID");
    const missing = await inject("POST", `/v1/finance/debt/${debtId}/emi/99/pay`, as(MAKER), {});
    expect(missing.statusCode).toBe(404);
    // heads removed -> pay is refused with 409 until they are configured again
    await setDebtHeads(TENANT, { loan: null, interest: null, bank: null });
    const noHeads = await inject("POST", `/v1/finance/debt/${debtId}/emi/2/pay`, as(MAKER), {});
    expect(noHeads.statusCode).toBe(409);
    expect(noHeads.json().code).toBe("GL_HEADS_NOT_CONFIGURED");
    await setDebtHeads(TENANT, { loan: H_LOAN, interest: H_INT, bank: H_BANK });
  });

  it("two concurrent payments of the same instalment: exactly one applies, outstanding moves once", async () => {
    capture();
    const before = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
    const first = await inject("POST", `/v1/finance/debt/${debtId}/emi/2/pay`, as(MAKER), { paymentRef: "A" });
    expect(first.statusCode).toBe(202);
    const dup = sent[0]!;
    sent.push({ topic: dup.topic, env: { ...dup.env, messageId: randomUUID(), actorId: CHECKER } });
    const q = await deliver();
    expect(q.dlq.length).toBe(0); // the loser is a recorded no-op, not a dead letter
    expect((await audits("pay_debt_emi_noop")).length).toBeGreaterThan(0);
    const after = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
    expect(BigInt(before.outstandingMinor) - BigInt(after.outstandingMinor)).toBe(BigInt(before.schedule[1].principalMinor));
    const j = await rows(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = ${COMMANDS.journalPost} AND payload->>'type' = 'payment' AND payload->'lines'->0->>'narration' LIKE 'Loan instalment 2%'`);
    expect(j).toHaveLength(1); // exactly one journal for the instalment, despite two commands
    expect(after.schedule.filter((r: { status: string }) => r.status === "paid")).toHaveLength(2);
  });

  it("a paid instalment never gets a journal that cannot post: a hard- or soft-closed month is refused (409 PERIOD_CLOSED) and the instalment stays due", async () => {
    for (const status of ["hard_close", "soft_close"]) {
      await scoped(TENANT, (tx) => tx.execute(sql`
        INSERT INTO gl.finance_period_close (tenant_id, fiscal_year, period, status, created_by)
        VALUES (${TENANT}::uuid, '2025-26', '2025-08', ${status}, ${MAKER}::uuid)
        ON CONFLICT (tenant_id, fiscal_year, period) DO UPDATE SET status = EXCLUDED.status`));
      capture();
      const res = await inject("POST", `/v1/finance/debt/${debtId}/emi/3/pay`, as(MAKER), { paidOn: "2025-08-15" });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("PERIOD_CLOSED");
      expect(sent).toHaveLength(0);
      // a hand-published command (bypassing the route) is refused by the consumer, NonRetryable, nothing changes
      sent = [{ topic: COMMANDS.debtEmiPay, env: { messageId: randomUUID(), type: COMMANDS.debtEmiPay, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0", payload: { debtId, installmentNo: 3, tenantId: TENANT, paidOn: "2025-08-15", paymentRef: null } } }];
      const q = await deliver();
      expect(q.dlq.length).toBe(1);
      const d = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
      expect(d.schedule[2]).toMatchObject({ installmentNo: 3, status: "due", glStatus: null });
    }
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${TENANT}::uuid AND period = '2025-08'`));
  });

  it("GL heads must be leaf heads, and a per-instalment bank head is validated like the configured one", async () => {
    const CHILD = "bbbbbbbb-7777-4000-8000-0000000fc105";
    const BANK2 = "bbbbbbbb-7777-4000-8000-0000000fc106";
    await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
      { id: CHILD, tenantId: TENANT, code: "FP1-BANK-CH", name: "Bank child", level: 2, classification: "asset", parentId: H_BANK, createdBy: MAKER, updatedBy: MAKER },
      { id: BANK2, tenantId: TENANT, code: "FP1-BANK2", name: "Second bank", level: 1, classification: "asset", createdBy: MAKER, updatedBy: MAKER },
    ]));
    // H_BANK now has a child -> a group head: refused when configured
    const put = await inject("PUT", "/v1/finance/settings", as(MAKER), {
      debtLoanLiabilityHeadId: H_LOAN, debtInterestExpenseHeadId: H_INT, debtBankHeadId: H_BANK, reason: "Configure debt heads again",
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().code).toBe("GL_HEAD_NOT_LEAF");
    // ...and, since it is the configured bank head, pay is refused until it is fixed
    const blocked = await inject("POST", `/v1/finance/debt/${debtId}/emi/3/pay`, as(MAKER), {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("GL_HEAD_NOT_LEAF");
    // a per-instalment bank head: a leaf asset head works; a liability head or a group head is refused
    capture();
    expect((await inject("POST", `/v1/finance/debt/${debtId}/emi/3/pay`, as(MAKER), { bankHeadId: H_LOAN })).json().code).toBe("GL_HEAD_WRONG_TYPE");
    expect((await inject("POST", `/v1/finance/debt/${debtId}/emi/3/pay`, as(MAKER), { bankHeadId: H_BANK })).json().code).toBe("GL_HEAD_NOT_LEAF");
    const ok = await inject("POST", `/v1/finance/debt/${debtId}/emi/3/pay`, as(MAKER), { bankHeadId: BANK2 });
    expect(ok.statusCode).toBe(202);
    await deliver();
    const jr = await rows<{ payload: any }>(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = ${COMMANDS.journalPost} AND payload->'lines'->0->>'narration' LIKE 'Loan instalment 3%'`);
    expect((jr[0]!.payload.lines as Array<{ accountCode: string }>).map((l) => l.accountCode)).toEqual([H_LOAN, H_INT, BANK2]);
    // restore a leaf configuration for the rest of the file
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM budget.finance_heads WHERE id = ${CHILD}::uuid`));
  });

  it("the GL consumer posts the instalment journal: balanced, and tied to the schedule row (principal, interest, total)", async () => {
    const d = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
    const emi = d.schedule[2];
    expect(emi.status).toBe("paid");
    const [{ journal_id }] = await rows<{ journal_id: string }>(sql`SELECT journal_id FROM treasury.finance_debt_emi WHERE debt_id = ${debtId}::uuid AND installment_no = 3`);
    // feed the queued journalPost command to the REAL gl consumer
    const msgs = await rows<{ payload: any }>(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = ${COMMANDS.journalPost} AND payload->>'id' = ${journal_id}`);
    expect(msgs).toHaveLength(1);
    sent = [{ topic: COMMANDS.journalPost, env: { messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0", payload: msgs[0]!.payload } }];
    const q = await deliver();
    expect(q.dlq.length).toBe(0);
    const [j] = await rows<{ status: string; type: string; lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }> }>(
      sql`SELECT status, type, lines FROM gl.finance_journals WHERE id = ${journal_id}::uuid`);
    expect(j).toMatchObject({ status: "posted", type: "payment" });
    const dr = j!.lines.reduce((a, l) => a + BigInt(l.debitMinor), 0n);
    const cr = j!.lines.reduce((a, l) => a + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
    expect(cr).toBe(BigInt(emi.totalMinor));
    const by = (code: string) => j!.lines.find((l) => l.accountCode === code)!;
    expect(BigInt(by(H_LOAN).debitMinor)).toBe(BigInt(emi.principalMinor));
    expect(BigInt(by(H_INT).debitMinor)).toBe(BigInt(emi.interestMinor));
    expect((await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json().schedule[2].glStatus).toBe("posted");
  });

  it("paying the last instalment closes the loan with nothing outstanding", async () => {
    for (let n = 4; n <= 12; n += 1) {
      capture();
      const res = await inject("POST", `/v1/finance/debt/${debtId}/emi/${n}/pay`, as(MAKER), {});
      expect(res.statusCode).toBe(202);
      await deliver();
    }
    const done = (await inject("GET", `/v1/finance/debt/${debtId}`, as(MAKER))).json();
    expect(done).toMatchObject({ status: "closed", outstandingMinor: "0" });
  });
});

describe("guarantee register (GAP-FINANCE-EXPENDITURE-GUARANTEES-01/-02)", () => {
  it("creates a guarantee with validity, beneficiary and linked reference; the list returns them", async () => {
    capture();
    const res = await inject("POST", "/v1/finance/guarantees", as(MAKER), {
      entity: "Metro Rail Corporation", type: "pbg", amountMinor: "250000000", feePct: "1.25",
      validUntil: "2031-09-30", beneficiary: "Public Works Department", linkedRef: "CON/2031/0042",
    });
    expect(res.statusCode).toBe(202);
    await deliver();
    const list = await inject("GET", "/v1/finance/guarantees", as(MAKER, ["finance_officer"]));
    const row = (list.json() as Array<Record<string, any>>).find((r) => r.id === res.json().id)!;
    expect(row).toMatchObject({
      entity: "Metro Rail Corporation", amountMinor: "250000000", validUntil: "2031-09-30",
      beneficiary: "Public Works Department", linkedRef: "CON/2031/0042", status: "active",
    });
  });

  it("validates dates, type and fee", async () => {
    const base = { entity: "X Ltd", type: "bg", amountMinor: "100", validUntil: "2031-09-30", beneficiary: "PWD" };
    expect((await inject("POST", "/v1/finance/guarantees", as(MAKER), { ...base, validUntil: "2031-02-30" })).statusCode).toBe(400);
    expect((await inject("POST", "/v1/finance/guarantees", as(MAKER), { ...base, type: "cash" })).statusCode).toBe(400);
    expect((await inject("POST", "/v1/finance/guarantees", as(MAKER), { ...base, feePct: "12.5" })).statusCode).toBe(400);
    expect((await inject("POST", "/v1/finance/guarantees", as(MAKER), { ...base, beneficiary: "" })).statusCode).toBe(400);
    expect((await inject("POST", "/v1/finance/guarantees", as(MAKER, ["audit_officer"]), base)).statusCode).toBe(403);
  });
});

describe("advances record sanctioning authority and reason (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01)", () => {
  const base = { advanceNo: "ADV-FP1-1", purpose: "Site survey", payee: "Field Office", amountMinor: "500000" };
  it("requires both, with field-level errors", async () => {
    const res = await inject("POST", "/v1/finance/advances", as(MAKER, ["finance_officer"]), base);
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors.map((f: { field: string }) => f.field).sort()).toEqual(["reason", "sanctionAuthority"]);
  });
  it("stores them and returns them on the register", async () => {
    capture();
    const res = await inject("POST", "/v1/finance/advances", as(MAKER, ["finance_officer"]), {
      ...base, sanctionAuthority: "Under Secretary (Finance)", reason: "Sanctioned vide order 12/2031",
    });
    expect(res.statusCode).toBe(202);
    await deliver();
    const list = await inject("GET", "/v1/finance/advances", as(MAKER, ["finance_officer"]));
    const row = (list.json() as Array<Record<string, any>>).find((r) => r.advanceNo === "ADV-FP1-1")!;
    expect(row).toMatchObject({ sanctionAuthority: "Under Secretary (Finance)", reason: "Sanctioned vide order 12/2031" });
  });
});

describe("utilisation certificates: declaration, over-claim, verify / return / resubmit", () => {
  const uc = (over: Record<string, unknown> = {}) => ({
    ucNo: `UC-${randomUUID().slice(0, 8)}`, purpose: "Road works utilisation", grantee: "Gram Panchayat Rampur",
    grantRef: "SN-FP1-001", amountMinor: "60000000", periodFrom: "2031-04-01", periodTo: "2032-03-31", declaration: true, ...over,
  });
  const ucRow = async (id: string) => (await rows(sql`SELECT * FROM payments.finance_uc WHERE id = ${id}::uuid`))[0]!;

  it("needs the declaration and a grantee, and a period that runs forwards", async () => {
    capture();
    const noDecl = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER), uc({ declaration: undefined }));
    expect(noDecl.statusCode).toBe(400);
    expect(noDecl.json().fieldErrors.map((f: { field: string }) => f.field)).toContain("declaration");
    const falseDecl = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER), uc({ declaration: false }));
    expect(falseDecl.statusCode).toBe(400);
    const noGrantee = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER), uc({ grantee: "" }));
    expect(noGrantee.statusCode).toBe(400);
    const backwards = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER), uc({ periodFrom: "2032-04-01", periodTo: "2031-04-01" }));
    expect(backwards.statusCode).toBe(400);
    expect(backwards.json().code ?? backwards.json().message).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  let first = "";
  it("records the declaration (who, when) and the grantee on the certificate", async () => {
    capture();
    const res = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc());
    expect(res.statusCode).toBe(202);
    first = res.json().id;
    await deliver();
    const row = await ucRow(first);
    expect(row).toMatchObject({ grantee: "Gram Panchayat Rampur", declaration_accepted: true, declared_by: MAKER, status: "submitted", amount_minor: "60000000" });
    expect(row.declared_at).toBeTruthy();
  });

  it("refuses a certificate that would exceed the sanctioned grant (route 409, and the consumer re-checks under a lock)", async () => {
    capture();
    const over = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ amountMinor: "50000000" }));
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe("UC_OVERCLAIM");
    expect(over.json().fieldErrors[0].field).toBe("amountMinor");
    expect(sent).toHaveLength(0);

    // Two certificates of 30,000,000 each racing for the 40,000,000 that is left: only one fits.
    const a = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ amountMinor: "30000000" }));
    const b = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ amountMinor: "30000000" }));
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    const total = await rows<{ n: string }>(sql`SELECT coalesce(sum(amount_minor),0)::text AS n FROM payments.finance_uc WHERE tenant_id = ${TENANT}::uuid AND grant_ref = 'SN-FP1-001'`);
    expect(BigInt(total[0]!.n)).toBeLessThanOrEqual(100000000n);
  });

  it("a free-text grant reference (no matching sanction) is not over-claim checked", async () => {
    capture();
    const res = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ grantRef: "PMAY-G", amountMinor: "999999999" }));
    expect(res.statusCode).toBe(202);
    await deliver();
  });

  it("the maker cannot verify their own certificate; a different officer can; it cannot be verified twice", async () => {
    capture();
    const selfVerify = await inject("POST", `/v1/finance/utilization-certificates/${first}/verify`, as(MAKER), {});
    expect(selfVerify.statusCode).toBe(409);
    expect(selfVerify.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect(sent).toHaveLength(0);
    const officer = await inject("POST", `/v1/finance/utilization-certificates/${first}/verify`, as(CHECKER, ["finance_officer"]), {});
    expect(officer.statusCode).toBe(403);
    const ok = await inject("POST", `/v1/finance/utilization-certificates/${first}/verify`, as(CHECKER), {});
    expect(ok.statusCode).toBe(202);
    await deliver();
    expect(await ucRow(first)).toMatchObject({ status: "verified", decided_by: CHECKER });
    const twice = await inject("POST", `/v1/finance/utilization-certificates/${first}/verify`, as(CHECKER2), {});
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe("UC_NOT_SUBMITTED");
    expect((await audits("verify_uc")).length).toBe(1);
  });

  let returned = "";
  it("return needs a reason; the reason is stored; the maker can resubmit and the cycle can repeat", async () => {
    capture();
    const made = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ grantRef: "FREE-REF-2", amountMinor: "1000" }));
    expect(made.statusCode).toBe(202);
    returned = made.json().id;
    await deliver();

    const noReason = await inject("POST", `/v1/finance/utilization-certificates/${returned}/reject`, as(CHECKER), {});
    expect(noReason.statusCode).toBe(400);
    capture();
    const rej = await inject("POST", `/v1/finance/utilization-certificates/${returned}/reject`, as(CHECKER), { reason: "Bills for Q3 missing" });
    expect(rej.statusCode).toBe(202);
    await deliver();
    expect(await ucRow(returned)).toMatchObject({ status: "rejected", rejection_reason: "Bills for Q3 missing", decided_by: CHECKER });
    const list = await inject("GET", "/v1/finance/utilization-certificates?limit=100", as(CHECKER));
    expect((list.json() as Array<Record<string, any>>).find((r) => r.id === returned)).toMatchObject({ status: "rejected", rejectionReason: "Bills for Q3 missing", resubmitCount: 0 });

    const earlyResubmit = await inject("POST", `/v1/finance/utilization-certificates/${first}/resubmit`, as(MAKER), {});
    expect(earlyResubmit.statusCode).toBe(409);
    expect(earlyResubmit.json().code).toBe("UC_NOT_REJECTED");

    capture();
    const resub = await inject("POST", `/v1/finance/utilization-certificates/${returned}/resubmit`, as(MAKER, ["finance_officer"]), { note: "Bills attached" });
    expect(resub.statusCode).toBe(202);
    await deliver();
    expect(await ucRow(returned)).toMatchObject({ status: "submitted", resubmit_count: 1 });

    // A second return after the resubmit is a NEW decision (fresh message id), not dropped as a duplicate.
    capture();
    const rej2 = await inject("POST", `/v1/finance/utilization-certificates/${returned}/reject`, as(CHECKER2), { reason: "Still incomplete" });
    expect(rej2.statusCode).toBe(202);
    await deliver();
    expect(await ucRow(returned)).toMatchObject({ status: "rejected", rejection_reason: "Still incomplete", decided_by: CHECKER2 });
  });

  it("two checkers deciding at once: exactly one decision lands", async () => {
    capture();
    await inject("POST", `/v1/finance/utilization-certificates/${returned}/resubmit`, as(MAKER, ["finance_officer"]), {});
    await deliver();
    capture();
    const v = await inject("POST", `/v1/finance/utilization-certificates/${returned}/verify`, as(CHECKER), {});
    expect(v.statusCode).toBe(202);
    sent.push(asActor(sent[0]!, CHECKER2));
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    expect((await ucRow(returned)).status).toBe("verified");
  });

  it("a returned UC cannot come back over the sanction: A rejected, B takes the headroom, resubmitting A is refused (route 409 and consumer)", async () => {
    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO budget.finance_sanctions (id, tenant_id, sanction_no, purpose, head_id, amount_minor, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}::uuid, 'SN-FP1-RS', 'Resubmit grant', ${HEAD_ID}::uuid, 1000, 'approved', ${MAKER}::uuid, ${MAKER}::uuid)`));
    const mk = async (amount: string) => {
      capture();
      const r = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ grantRef: "SN-FP1-RS", amountMinor: amount }));
      expect(r.statusCode).toBe(202);
      await deliver();
      return r.json().id as string;
    };
    const a = await mk("600");
    capture();
    expect((await inject("POST", `/v1/finance/utilization-certificates/${a}/reject`, as(CHECKER), { reason: "Bills missing here" })).statusCode).toBe(202);
    await deliver();
    await mk("600"); // B uses the headroom A released
    capture();
    const route = await inject("POST", `/v1/finance/utilization-certificates/${a}/resubmit`, as(MAKER, ["finance_officer"]), {});
    expect(route.statusCode).toBe(409);
    expect(route.json().code).toBe("UC_OVERCLAIM");
    expect(sent).toHaveLength(0);
    // hand-published resubmit (bypassing the route) is refused by the consumer under the sanction lock
    sent = [{ topic: COMMANDS.ucResubmit, env: { messageId: randomUUID(), type: COMMANDS.ucResubmit, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: a, tenantId: TENANT, note: null } } }];
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    expect((await ucRow(a)).status).toBe("rejected");
  });

  it("with the second-approver setting off the maker may verify their own certificate", async () => {
    await setFinanceSettings(TENANT, { makerCheckerEnabled: false });
    capture();
    const made = await inject("POST", "/v1/finance/utilization-certificates", as(MAKER, ["finance_officer"]), uc({ grantRef: "FREE-REF-3", amountMinor: "1000" }));
    await deliver();
    capture();
    const ok = await inject("POST", `/v1/finance/utilization-certificates/${made.json().id}/verify`, as(MAKER), {});
    expect(ok.statusCode).toBe(202);
    await deliver();
    expect((await ucRow(made.json().id)).status).toBe("verified");
    await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${TENANT}::uuid`));
  });
});

describe("sanction with an eOffice file in flight cannot be approved directly (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01)", () => {
  const status = async () => (await rows(sql`SELECT status, efile_submitted_at, efile_file_no FROM budget.finance_sanctions WHERE id = ${SANCTION_EFILE}::uuid`))[0]!;

  it("submit-approval records the file; the detail reports it; /approve is refused 409", async () => {
    capture();
    const res = await inject("POST", `/v1/finance/sanctions/${SANCTION_EFILE}/submit-approval`, as(MAKER, ["finance_officer"]), { fileNo: "FIN/2031/77" });
    expect(res.statusCode).toBe(202);
    await deliver();
    expect(await status()).toMatchObject({ status: "pending_approval", efile_file_no: "FIN/2031/77" });
    expect((await status()).efile_submitted_at).toBeTruthy();
    const detail = await inject("GET", `/v1/finance/sanctions/${SANCTION_EFILE}`, as(CHECKER));
    expect(detail.json()).toMatchObject({ efileInFlight: true, efileFileNo: "FIN/2031/77" });

    capture();
    const approve = await inject("PATCH", `/v1/finance/sanctions/${SANCTION_EFILE}/approve`, as(CHECKER), {});
    expect(approve.statusCode).toBe(409);
    expect(approve.json().code).toBe("EFILE_IN_FLIGHT");
    expect(sent).toHaveLength(0);
  });

  it("a hand-published approve command is refused by the consumer's conditional update too (race-safe)", async () => {
    sent = [{
      topic: COMMANDS.sanctionApprove,
      env: { messageId: randomUUID(), type: COMMANDS.sanctionApprove, tenantId: TENANT, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: SANCTION_EFILE, tenantId: TENANT } },
    }];
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    expect((await status()).status).toBe("pending_approval");
  });

  it("when the eOffice file is returned the flag clears and direct approval is possible again", async () => {
    sent = [{
      topic: CONSUMED_EVENTS.sanctionFileDecided,
      env: {
        messageId: randomUUID(), type: CONSUMED_EVENTS.sanctionFileDecided, tenantId: TENANT, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          fileId: randomUUID(), fileNo: "FIN/2031/77", refType: "finance_sanction", refId: SANCTION_EFILE,
          decision: "returned", decidedBy: CHECKER, decidedAt: "2031-06-01T10:00:00Z",
        },
      },
    }];
    await deliver();
    expect((await status()).efile_submitted_at).toBeNull();
    capture();
    const approve = await inject("PATCH", `/v1/finance/sanctions/${SANCTION_EFILE}/approve`, as(CHECKER), {});
    expect(approve.statusCode).toBe(202);
    await deliver();
    expect((await status()).status).toBe("approved");
  });

  it("an already-approved sanction is not pulled back to pending by a late submit-approval", async () => {
    capture();
    const res = await inject("POST", `/v1/finance/sanctions/${SANCTION_EFILE}/submit-approval`, as(MAKER, ["finance_officer"]), {});
    expect(res.statusCode).toBe(202);
    const q = await deliver();
    expect(q.dlq.length).toBe(1);
    expect((await status()).status).toBe("approved");
  });
});

describe("office directory names fund releases (GAP-FINANCE-BUDGET-FUND-RELEASES-01)", () => {
  const FROM = randomUUID();
  const TO = randomUUID();
  const UNKNOWN = randomUUID();
  it("creates offices (admin only, unique code) and joins names onto distributions; unknown ids carry a null name", async () => {
    capture();
    const a = await inject("POST", "/v1/finance/offices", as(MAKER), { code: "dept-fin", name: "Department of Finance" });
    expect(a.statusCode).toBe(202);
    const b = await inject("POST", "/v1/finance/offices", as(MAKER), { code: "dist-roads", name: "District Roads Office" });
    await deliver();
    const denied = await inject("POST", "/v1/finance/offices", as(MAKER, ["finance_officer"]), { code: "X1", name: "Nope" });
    expect(denied.statusCode).toBe(403);
    const dup = await inject("POST", "/v1/finance/offices", as(MAKER), { code: "DEPT-FIN", name: "Again" });
    expect(dup.statusCode).toBe(409);

    const list = await inject("GET", "/v1/finance/offices", as(CHECKER, ["audit_officer"]));
    expect(list.json().total).toBe(2);
    const offices = (list.json().data as Array<{ id: string; code: string }>);
    const deptId = offices.find((o) => o.code === "DEPT-FIN")!.id;
    const roadsId = offices.find((o) => o.code === "DIST-ROADS")!.id;

    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO budget.finance_allocation_distributions (id, tenant_id, allocation_id, fy, head_id, from_office_id, to_office_id, amount_minor, effective_from, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}::uuid, ${randomUUID()}::uuid, '2031-32', ${HEAD_ID}::uuid, ${deptId}::uuid, ${roadsId}::uuid, 1000, '2031-04-01', ${MAKER}::uuid, ${MAKER}::uuid),
             (gen_random_uuid(), ${TENANT}::uuid, ${randomUUID()}::uuid, '2031-32', ${HEAD_ID}::uuid, ${FROM}::uuid, ${UNKNOWN}::uuid, 2000, '2031-04-01', ${MAKER}::uuid, ${MAKER}::uuid)`));
    const res = await inject("GET", "/v1/finance/allocation-distributions?fy=2031-32", as(CHECKER, ["audit_officer"]));
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<Record<string, any>>;
    expect(data.find((r) => r.amountMinor === "1000")).toMatchObject({ fromOfficeName: "Department of Finance", toOfficeName: "District Roads Office" });
    expect(data.find((r) => r.amountMinor === "2000")).toMatchObject({ fromOfficeName: null, toOfficeName: null });
    void TO;
  });
});

describe("audited bank-account reveal (GAP-FINANCE-CONFIG-02)", () => {
  let id = "";
  it("the list stays masked; reveal needs admin role + reason, returns the number and publishes an audit command first", async () => {
    capture();
    const created = await inject("POST", "/v1/finance/bank-accounts", as(MAKER), {
      bankName: "State Bank of India", accountNo: "123456789012", ifsc: "SBIN0001234", accountType: "current",
    });
    expect(created.statusCode).toBe(202);
    id = created.json().id;
    await deliver();

    const masked = await inject("GET", "/v1/finance/bank-accounts", as(MAKER));
    const m = (masked.json().data as Array<Record<string, any>>).find((r) => r.id === id)!;
    expect(m.accountNoLast4).toBe("9012");
    expect(JSON.stringify(masked.json())).not.toContain("123456789012");

    expect((await inject("POST", `/v1/finance/bank-accounts/${id}/reveal`, as(MAKER, ["audit_officer"]), { reason: "Quarterly confirmation" })).statusCode).toBe(403);
    expect((await inject("POST", `/v1/finance/bank-accounts/${id}/reveal`, as(MAKER), {})).statusCode).toBe(400);
    expect((await inject("POST", `/v1/finance/bank-accounts/${randomUUID()}/reveal`, as(MAKER), { reason: "Quarterly confirmation" })).statusCode).toBe(404);

    capture();
    const ok = await inject("POST", `/v1/finance/bank-accounts/${id}/reveal`, as(MAKER), { reason: "Quarterly confirmation with bank" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id, accountNo: "123456789012", ifsc: "SBIN0001234" });
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(sent.map((s) => s.topic)).toEqual([COMMANDS.bankAccountReveal]);
    await deliver();
    const audit = (await audits("reveal_bank_account"))[0]!.payload;
    expect(audit).toMatchObject({ resourceId: id, reason: "Quarterly confirmation with bank", accountNoLast4: "9012" });
    expect(JSON.stringify(audit)).not.toContain("123456789012");
  });

  it("fails closed: if the audit command cannot be published no digits are returned", async () => {
    vi.spyOn(queue, "publish").mockRejectedValue(new Error("queue down"));
    const res = await inject("POST", `/v1/finance/bank-accounts/${id}/reveal`, as(MAKER), { reason: "Quarterly confirmation with bank" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("123456789012");
  });
});
