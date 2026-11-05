/**
 * UAT T-PERIOD (bundle 19) -- GL posting rules, real Postgres (finance app role, FORCE RLS), real GL consumer on a
 * MemoryQueue:
 *  D-03 no expenditure without a budget provision (NO_BUDGET_PROVISION), receipts unaffected;
 *  D-07 no posting into a draft (not yet active) FY; no depreciation for a future month;
 *  D-02 income-tax (statutory) depreciation is a memorandum (no GL), company book posts only on accrual;
 *  D-12 cash basis: disposal posts only the sale proceeds receipt, acquisition is a memorandum; accrual refuses the
 *       disposal of an asset that was never capitalised;
 *  D-06 system-dated postings use the IST date (00:01 IST on 1 April is the new FY).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq, and, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals, financeJournalLines } from "../src/modules/gl/schema.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../src/topics.js";
import { todayIST, currentPeriodIST } from "../src/shared/ist-date.js";

const CASH = randomUUID();
const ACC = randomUUID();
const ACTOR = randomUUID();
const msgIds: string[] = [];
const heads: Record<string, Record<string, string>> = { [CASH]: {}, [ACC]: {} };
const PERIOD = currentPeriodIST();
const TODAY = todayIST();
const FY = (() => { const y = Number(TODAY.slice(0, 4)); const m = Number(TODAY.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; })();

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
let q: MemoryQueue;
async function publish(tenantId: string, raw: Record<string, unknown>, topic: string = COMMANDS.journalPost): Promise<void> {
  const messageId = randomUUID(); msgIds.push(messageId);
  // the GL spine payload carries its tenant (finance.gl.post producers always set it)
  const payload = topic === COMMANDS.journalPost && "lines" in raw ? { ...raw, tenantId } : raw;
  await q.publish(topic, { messageId, type: topic, tenantId, actorId: ACTOR, correlationId: `tp-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload });
  await q.drain();
}
const journal = (tenantId: string, id: string) => scoped(tenantId, (tx) => tx.select().from(financeJournals).where(and(eq(financeJournals.tenantId, tenantId), eq(financeJournals.id, id))));
async function linesOf(tenantId: string, journalId: string): Promise<string[][]> {
  const rows = await scoped(tenantId, (tx) => tx.select().from(financeJournalLines).where(eq(financeJournalLines.journalId, journalId)));
  return (rows as Array<{ headCode: string | null; debitMinor: bigint; creditMinor: bigint }>).map((r) => [r.headCode ?? "", String(r.debitMinor), String(r.creditMinor)]).sort();
}
async function outbox(tenantId: string, topic: string) {
  return (await scoped(tenantId, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, topic))))) as Array<{ payload: Record<string, unknown> }>;
}
const rejectedCodes = async (tenantId: string, journalId: string) => (await outbox(tenantId, EVENTS.glRejected)).filter((r) => r.payload.journalId === journalId).map((r) => r.payload.code);
const memo = (tenantId: string, assetId: string) => scoped(tenantId, (tx) => tx.execute(sql`SELECT period, dep_book, amount_minor::text AS amount, basis, reason FROM gl.depreciation_memo WHERE tenant_id = ${tenantId}::uuid AND asset_id = ${assetId}::uuid ORDER BY dep_book`)) as Promise<Array<Record<string, string>>>;
const jv = (id: string, lines: Array<[string, number, number]>, extra: Record<string, unknown> = {}) => ({
  id, tenantId: undefined as string | undefined, voucherNo: `TP-${id.slice(0, 8)}`, type: "journal", postingDate: `${PERIOD}-02`,
  lines: lines.map(([accountCode, dr, cr]) => ({ accountCode, debitMinor: String(dr), creditMinor: String(cr) })), ...extra,
});

beforeAll(async () => {
  const chart: Array<[string, string, string]> = [
    ["1100", "Cash / Bank", "asset"], ["1101", "Bank - Salary", "asset"], ["1200", "Fixed Assets", "capital"], ["1250", "Accumulated Depreciation", "capital"],
    ["2101", "Net Salary Payable", "liability"], ["2202", "General Education", "expense"], ["2210", "Medical", "expense"],
    ["4100", "Citizen Service Fees", "income"], ["4310", "Sale Proceeds of Assets", "income"], ["4200", "Gain/Loss", "expense"],
    ["5100", "Depreciation Expense", "expense"], ["5101", "Statutory Depreciation Expense", "expense"], ["1290", "Acquisition offset", "liability"],
  ];
  for (const t of [CASH, ACC]) {
    for (const [code, name, classification] of chart) {
      const id = randomUUID(); heads[t]![code] = id;
      await scoped(t, (tx) => tx.insert(financeHeads).values({ id, tenantId: t, code, name, level: 1, classification, createdBy: ACTOR, updatedBy: ACTOR }));
    }
    // a provision for 2210 only (2202 has none)
    await scoped(t, (tx) => tx.insert(financeBudgets).values({ tenantId: t, headId: heads[t]!["2210"]!, fy: FY, beMinor: 100000n, reMinor: 100000n, createdBy: ACTOR, updatedBy: ACTOR }));
  }
  await scoped(ACC, (tx) => tx.insert(financeSettings).values({ tenantId: ACC, accountingBasis: "accrual", updatedBy: ACTOR }));
  q = tenantWrappedQueue();
  registerGlConsumers(q);
  await q.start();
});
afterAll(async () => {
  vi.useRealTimers();
  await q.stop();
  for (const t of [CASH, ACC]) await scoped(t, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t))).catch(() => {});
  for (const m of msgIds) await db.delete(processed).where(eq(processed.messageId, m)).catch(() => {});
  await sqlClient.end();
});

describe("D-03: no expenditure without a budget provision (GFR)", () => {
  it("refuses a debit to an expenditure head with no provision for the FY: no journal, finance.gl.rejected NO_BUDGET_PROVISION", async () => {
    const id = randomUUID();
    await publish(CASH, jv(id, [["2202", 5000, 0], ["1100", 0, 5000]]));
    expect(await journal(CASH, id)).toHaveLength(0);
    expect(await rejectedCodes(CASH, id)).toEqual(["NO_BUDGET_PROVISION"]);
  });
  it("posts the same debit on a head that has a provision, and draws the budget", async () => {
    const id = randomUUID();
    await publish(CASH, jv(id, [["2210", 5000, 0], ["1100", 0, 5000]]));
    expect(await journal(CASH, id)).toHaveLength(1);
    const [b] = await scoped(CASH, (tx) => tx.select().from(financeBudgets).where(and(eq(financeBudgets.tenantId, CASH), eq(financeBudgets.headId, heads[CASH]!["2210"]!))));
    expect(b!.utilisedMinor).toBe(5000n);
  });
  it("does not affect receipts (Dr cash / Cr income needs no provision)", async () => {
    const id = randomUUID();
    await publish(CASH, jv(id, [["1100", 7000, 0], ["4100", 0, 7000]], { type: "receipt" }));
    expect(await journal(CASH, id)).toHaveLength(1);
  });
  it("a budget override cannot stand in for a missing provision", async () => {
    const id = randomUUID();
    await publish(CASH, jv(id, [["2202", 100, 0], ["1100", 0, 100]], { budgetOverride: true, overrideReason: "urgent repairs ordered" }));
    expect(await rejectedCodes(CASH, id)).toEqual(["NO_BUDGET_PROVISION"]);
  });
});

describe("D-07: no posting into a financial year that is not active yet", () => {
  it("refuses a journal dated in a draft FY with FY_NOT_ACTIVE", async () => {
    await scoped(CASH, (tx) => tx.execute(sql`INSERT INTO gl.finance_fiscal_years (tenant_id, code, label, start_date, end_date, status, created_by)
      VALUES (${CASH}::uuid, '2031-32', 'FY 2031-32', '2031-04-01', '2032-03-31', 'draft', ${ACTOR}::uuid)`));
    const id = randomUUID();
    await publish(CASH, { ...jv(id, [["1100", 100, 0], ["4100", 0, 100]], { type: "receipt" }), postingDate: "2031-04-01" });
    expect(await journal(CASH, id)).toHaveLength(0);
    expect(await rejectedCodes(CASH, id)).toEqual(["FY_NOT_ACTIVE"]);
  });
  it("refuses depreciation for a month that has not started (PERIOD_FUTURE), with feedback to asset-service", async () => {
    const assetId = randomUUID();
    await publish(ACC, { type: "depreciation", assetId, period: "2099-03", depAmountMinor: "1000", depBook: "company" });
    const id = deterministicId(`depreciation:${assetId}:2099-03:company`);
    expect(await journal(ACC, id)).toHaveLength(0);
    expect(await rejectedCodes(ACC, id)).toEqual(["PERIOD_FUTURE"]);
    expect(await memo(ACC, assetId)).toHaveLength(0);
  });
});

describe("D-02: statutory depreciation is a memorandum; company book posts only on accrual", () => {
  it("accrual: company book Dr 5100 / Cr 1250; statutory book recorded in the memo with NO journal (never 5101 / 1250)", async () => {
    const assetId = randomUUID();
    await publish(ACC, { type: "depreciation", assetId, period: PERIOD, depAmountMinor: "1000", depBook: "company" });
    await publish(ACC, { type: "depreciation", assetId, period: PERIOD, depAmountMinor: "2500", depBook: "statutory" });
    const company = deterministicId(`depreciation:${assetId}:${PERIOD}:company`);
    const stat = deterministicId(`depreciation:${assetId}:${PERIOD}:statutory`);
    expect(await linesOf(ACC, company)).toEqual([["1250", "0", "1000"], ["5100", "1000", "0"]]);
    expect(await journal(ACC, stat)).toHaveLength(0);
    expect(await memo(ACC, assetId)).toEqual([{ period: PERIOD, dep_book: "statutory", amount: "2500", basis: "accrual", reason: "income_tax_memorandum" }]);
    // redelivery of the statutory entry records nothing twice
    await publish(ACC, { type: "depreciation", assetId, period: PERIOD, depAmountMinor: "2500", depBook: "statutory" });
    expect(await memo(ACC, assetId)).toHaveLength(1);
    expect(q.dlq.filter((m) => m.payload && (m.payload as { assetId?: string }).assetId === assetId)).toHaveLength(0);
  });
  it("cash (default): both books are memoranda, no depreciation journal at all", async () => {
    const assetId = randomUUID();
    await publish(CASH, { type: "depreciation", assetId, period: PERIOD, depAmountMinor: "1000", depBook: "company" });
    await publish(CASH, { type: "depreciation", assetId, period: PERIOD, depAmountMinor: "2500", depBook: "statutory" });
    expect(await journal(CASH, deterministicId(`depreciation:${assetId}:${PERIOD}:company`))).toHaveLength(0);
    expect((await memo(CASH, assetId)).map((m) => [m.dep_book, m.reason])).toEqual([["company", "cash_basis_memorandum"], ["statutory", "income_tax_memorandum"]]);
    expect(await rejectedCodes(CASH, deterministicId(`depreciation:${assetId}:${PERIOD}:company`))).toEqual([]);
  });
});

describe("D-12: asset register on the cash basis is a memorandum; accrual capitalises", () => {
  const disposal = (assetId: string, extra: Record<string, unknown> = {}) => ({ type: "asset_disposal", assetId, acquisitionCost: "120000", accumulatedDep: "3000", proceeds: 5000, gainLoss: "-112000", currency: "INR", disposalDate: TODAY, ...extra });
  it("cash: a disposal posts only the sale proceeds receipt (Dr 1100 / Cr 4310), never a credit to 1200", async () => {
    const assetId = randomUUID();
    await publish(CASH, disposal(assetId));
    expect(await linesOf(CASH, deterministicId(`asset_disposal:${assetId}`))).toEqual([["1100", "5000", "0"], ["4310", "0", "5000"]]);
  });
  it("cash: a disposal with no proceeds posts no journal", async () => {
    const assetId = randomUUID();
    await publish(CASH, disposal(assetId, { proceeds: 0, gainLoss: "-117000" }));
    expect(await journal(CASH, deterministicId(`asset_disposal:${assetId}`))).toHaveLength(0);
  });
  it("cash: an asset acquisition journal is a memorandum (nothing posted; asset-service told it is settled)", async () => {
    const id = randomUUID();
    await publish(CASH, { id, type: "asset_acquisition", voucherNo: `ACQ/${TODAY}/${id.slice(0, 8)}`, postingDate: TODAY, lines: [{ accountCode: "1200", debitMinor: "120000", creditMinor: "0" }, { accountCode: "1290", debitMinor: "0", creditMinor: "120000" }] });
    expect(await journal(CASH, id)).toHaveLength(0);
    expect((await outbox(CASH, EVENTS.glPosted)).filter((r) => r.payload.journalId === id).map((r) => r.payload.memorandum)).toEqual([true]);
  });
  it("accrual: the acquisition is capitalised (Dr 1200) and the disposal writes off cost and accumulated depreciation", async () => {
    const id = randomUUID(); const assetId = randomUUID();
    await publish(ACC, { id, type: "asset_acquisition", voucherNo: `ACQ/${TODAY}/${id.slice(0, 8)}`, postingDate: TODAY, lines: [{ accountCode: "1200", debitMinor: "120000", creditMinor: "0" }, { accountCode: "1290", debitMinor: "0", creditMinor: "120000" }] });
    expect(await linesOf(ACC, id)).toEqual([["1200", "120000", "0"], ["1290", "0", "120000"]]);
    await publish(ACC, disposal(assetId, { capitalised: true }));
    expect(await linesOf(ACC, deterministicId(`asset_disposal:${assetId}`))).toEqual([["1100", "5000", "0"], ["1200", "0", "120000"], ["1250", "3000", "0"], ["4200", "112000", "0"]]);
  });
  it("accrual: the disposal of an asset that was never capitalised is refused (ASSET_NOT_CAPITALISED), 1200 cannot go negative", async () => {
    const assetId = randomUUID();
    await publish(ACC, disposal(assetId, { capitalised: false }));
    const id = deterministicId(`asset_disposal:${assetId}`);
    expect(await journal(ACC, id)).toHaveLength(0);
    expect(await rejectedCodes(ACC, id)).toEqual(["ASSET_NOT_CAPITALISED"]);
  });
});

describe("D-06: system-dated postings use the IST date", () => {
  it("a payroll settlement processed at 00:01 IST on 1 April (18:31 UTC on 31 March) is dated 1 April, in the new FY", async () => {
    // FY 2031-32 (the year before) is closed; 2032-33 has no row, so only the period rules apply
    await scoped(CASH, (tx) => tx.execute(sql`INSERT INTO gl.finance_fiscal_years (tenant_id, code, label, start_date, end_date, status, created_by)
      VALUES (${CASH}::uuid, '2031-32', 'FY 2031-32', '2031-04-01', '2032-03-31', 'closed', ${ACTOR}::uuid) ON CONFLICT DO NOTHING`));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2032-03-31T18:31:00Z"));
    const runId = randomUUID();
    try {
      await publish(CASH, { runId, month: "2032-03", totalNetMinor: "10000" }, CONSUMED_EVENTS.payrollRunDisbursed);
    } finally { vi.useRealTimers(); }
    const [j] = await journal(CASH, deterministicId(`payroll_settlement:${runId}`));
    expect(String(j!.postingDate)).toBe("2032-04-01");
  });
});
