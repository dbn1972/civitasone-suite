/**
 * UAT T-PERIOD (bundle 19), real Postgres, routes + real consumers (the fp01 capture-and-deliver harness):
 *  D-01 hard-close -> reopen really reopens (state change first, then log + event + audit, one transaction) -> a
 *       posting is allowed -> re-close; with the second-approver setting on, a hard-close reopen is a period_reopen
 *       change request a DIFFERENT finance_admin approves; a reopen that changes nothing records nothing.
 *  D-05 / D-09 / D-13 year-end: FY-bounded TB and balance sheet; the year-end close generates next-year opening
 *       balances for carry-forward heads only (revenue / expenditure start at 0, their net on the fund), idempotent
 *       and audited; the 31 March lapse statement; budgets ?fy= filter and "lapsed"; ledger opening / closing per month.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { setFinanceSettings } from "./_finance-settings.js";
import { registerPeriodCloseConsumers } from "../src/modules/period-close/consumer.js";
import { registerApprovalsConsumers } from "../src/modules/approvals/consumer.js";
import { registerYearEndConsumers } from "../src/modules/year-end/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeLedger, financeJournals } from "../src/modules/gl/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";

// the HS256 test signing key comes from vitest.config.ts (env JWT_SECRET); no key literal in this file
const SECRET = process.env.JWT_SECRET as string;
const ADMIN_A = "00000000-aaaa-4000-8000-0000000b1901";
const ADMIN_B = "00000000-aaaa-4000-8000-0000000b1902";
const OFFICER = "00000000-aaaa-4000-8000-0000000b1903";
const DIRECT = randomUUID();   // second-approver setting OFF
const MC = randomUUID();       // default settings (second approver ON)
const YE = randomUUID();       // year-end tenant
const as = (t: string, sub: string, roles = ["finance_admin"]) => ({ authorization: `Bearer ${signToken({ sub, tid: t, roles, sid: `s-${sub.slice(-3)}` }, SECRET)}` });

type Sent = { topic: string; env: Record<string, unknown> & { messageId: string } };
let sent: Sent[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
let dlq: unknown[] = [];
async function deliver(): Promise<void> {
  const q = tenantWrappedQueue();
  registerPeriodCloseConsumers(q); registerApprovalsConsumers(q); registerYearEndConsumers(q); registerGlConsumers(q);
  await q.start();
  const batch = sent; sent = [];
  for (const b of batch) await q.publish(b.topic, b.env as never);
  await q.drain();
  dlq = [...dlq, ...q.dlq];
  await q.stop();
}
const call = async (method: "GET" | "POST" | "PATCH", url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const rows = async <T = Record<string, unknown>>(t: string, q: ReturnType<typeof sql>): Promise<T[]> => {
  const r: any = await scoped(t, (tx) => tx.execute(q)); return (Array.isArray(r) ? r : r.rows ?? []) as T[];
};
const periodStatus = async (t: string, p: string) => (await rows<{ status: string }>(t, sql`SELECT status FROM gl.finance_period_close WHERE tenant_id = ${t}::uuid AND period = ${p}`))[0]?.status ?? "open";
const audits = async (t: string, action: string) => ((await scoped(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "audit.event.record"))))) as Array<{ payload: Record<string, unknown> }>)
  .map((r) => r.payload).filter((p) => p.action === action);
const REASON = { reason: "UAT T-PERIOD bundle 19 regression test" };

const heads: Record<string, string> = {};
async function chart(t: string, list: Array<[string, string, string]>) {
  for (const [code, name, classification] of list) {
    const id = randomUUID(); heads[`${t}:${code}`] = id;
    await scoped(t, (tx) => tx.insert(financeHeads).values({ id, tenantId: t, code, name, level: 1, classification, createdBy: ADMIN_A, updatedBy: ADMIN_A }));
  }
}
const ledger = (t: string, code: string, dr: bigint, cr: bigint, postingDate: string) => scoped(t, (tx) => tx.insert(financeLedger).values({
  tenantId: t, headId: heads[`${t}:${code}`]!, debitMinor: dr, creditMinor: cr, balanceMinor: dr - cr, voucherNo: `YE-${randomUUID().slice(0, 6)}`, postingDate, createdBy: ADMIN_A, updatedBy: ADMIN_A,
}));

beforeAll(async () => {
  vi.spyOn(queue, "publish").mockImplementation((async (topic: string, env: Sent["env"]) => { sent.push({ topic, env }); }) as never);
  app = await buildApp();
  await setFinanceSettings(DIRECT, { makerCheckerEnabled: false });
  for (const t of [DIRECT, MC]) await chart(t, [["1100", "Cash / Bank", "asset"], ["4100", "Fees", "income"]]);
  await chart(YE, [["1100", "Cash / Bank", "asset"], ["4100", "Fees", "income"], ["2202", "General Education", "expense"], ["8443", "Civil Deposits", "public_account"], ["3100", "Accumulated Fund", "equity"]]);
});
afterAll(async () => { vi.restoreAllMocks(); await app.close(); await sqlClient.end(); });

describe("D-01: reopening a hard-closed month really reopens it", () => {
  it("hard-close -> reopen -> status open, reopen log + audit written after the change -> a posting is allowed -> re-close", async () => {
    const P = "2026-08";
    expect((await call("POST", `/v1/finance/periods/${P}/hard-close`, as(DIRECT, ADMIN_A), REASON)).statusCode).toBe(202);
    await deliver();
    expect(await periodStatus(DIRECT, P)).toBe("hard_close");
    expect((await call("POST", `/v1/finance/periods/${P}/reopen`, as(DIRECT, OFFICER, ["finance_officer"]), REASON)).statusCode).toBe(403);
    expect((await call("POST", `/v1/finance/periods/${P}/reopen`, as(DIRECT, ADMIN_A), { reason: "short" })).statusCode).toBe(400);
    expect((await call("POST", `/v1/finance/periods/${P}/reopen`, as(DIRECT, ADMIN_A), REASON)).statusCode).toBe(202);
    await deliver();
    expect(await periodStatus(DIRECT, P)).toBe("open");
    const log = await rows<{ from_status: string; to_status: string; reason: string }>(DIRECT, sql`SELECT from_status, to_status, reason FROM gl.finance_period_reopen_log WHERE tenant_id = ${DIRECT}::uuid AND period = ${P}`);
    expect(log).toEqual([{ from_status: "hard_close", to_status: "open", reason: REASON.reason }]);
    expect((await audits(DIRECT, "reopen")).map((a) => [a.resourceId, a.fromStatus, a.toStatus])).toEqual([[P, "hard_close", "open"]]);
    const jid = randomUUID();
    sent.push({ topic: COMMANDS.journalPost, env: { messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: DIRECT, actorId: ADMIN_A, correlationId: "b19-reopen", schemaVersion: "1.0",
      payload: { id: jid, tenantId: DIRECT, voucherNo: "B19-REOPEN-1", type: "receipt", postingDate: `${P}-10`, lines: [{ accountCode: "1100", debitMinor: "500", creditMinor: "0" }, { accountCode: "4100", debitMinor: "0", creditMinor: "500" }] } } });
    await deliver();
    expect(await scoped(DIRECT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, jid)))).toHaveLength(1);
    expect((await call("POST", `/v1/finance/periods/${P}/hard-close`, as(DIRECT, ADMIN_A), REASON)).statusCode).toBe(202);
    await deliver();
    expect(await periodStatus(DIRECT, P)).toBe("hard_close");
  });
  it("a reopen that changes nothing records nothing (no log, no audit, no event)", async () => {
    const P = "2026-06";
    sent.push({ topic: COMMANDS.periodReopen, env: { messageId: randomUUID(), type: COMMANDS.periodReopen, tenantId: DIRECT, actorId: ADMIN_A, correlationId: "b19-noop", schemaVersion: "1.0", payload: { tenantId: DIRECT, period: P, reason: REASON.reason } } });
    await deliver();
    expect(await rows(DIRECT, sql`SELECT 1 FROM gl.finance_period_reopen_log WHERE tenant_id = ${DIRECT}::uuid AND period = ${P}`)).toHaveLength(0);
    expect((await audits(DIRECT, "reopen")).filter((a) => a.resourceId === P)).toHaveLength(0);
  });
  it("second approver ON: the reopen is a period_reopen request; the month stays hard-closed until a DIFFERENT finance_admin approves", async () => {
    const P = "2026-09";
    expect((await call("POST", `/v1/finance/periods/${P}/hard-close`, as(MC, ADMIN_A), REASON)).statusCode).toBe(202);
    await deliver();
    const r = await call("POST", `/v1/finance/periods/${P}/reopen`, as(MC, ADMIN_A), REASON);
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("pending_approval");
    await deliver();
    expect(await periodStatus(MC, P)).toBe("hard_close");
    const dup = await call("POST", `/v1/finance/periods/${P}/reopen`, as(MC, ADMIN_B), REASON);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("PERIOD_REOPEN_PENDING");
    sent.push({ topic: COMMANDS.periodReopen, env: { messageId: randomUUID(), type: COMMANDS.periodReopen, tenantId: MC, actorId: ADMIN_A, correlationId: "b19-bypass", schemaVersion: "1.0", payload: { tenantId: MC, period: P, reason: REASON.reason } } });
    await deliver();
    expect(await periodStatus(MC, P)).toBe("hard_close");
    const id = r.json().id as string;
    await call("POST", `/v1/finance/change-requests/${id}/approve`, as(MC, ADMIN_A), {});
    await deliver();
    expect(await periodStatus(MC, P)).toBe("hard_close");
    expect((await call("POST", `/v1/finance/change-requests/${id}/approve`, as(MC, ADMIN_B), {})).statusCode).toBe(202);
    await deliver();
    expect(await periodStatus(MC, P)).toBe("open");
    const a = (await audits(MC, "reopen")).filter((x) => x.resourceId === P);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ fromStatus: "hard_close", changeRequestId: id });
  });
});

describe("D-05 / D-09 / D-13: year-end", () => {
  beforeAll(async () => {
    await ledger(YE, "1100", 100000n, 0n, "2025-06-10"); await ledger(YE, "4100", 0n, 100000n, "2025-06-10");
    await ledger(YE, "2202", 30000n, 0n, "2025-09-10"); await ledger(YE, "1100", 0n, 30000n, "2025-09-10");
    await ledger(YE, "1100", 5000n, 0n, "2026-03-31"); await ledger(YE, "8443", 0n, 5000n, "2026-03-31");
    await ledger(YE, "2202", 1000n, 0n, "2026-05-10"); await ledger(YE, "1100", 0n, 1000n, "2026-05-10");
    await scoped(YE, (tx) => tx.insert(financeBudgets).values({ tenantId: YE, headId: heads[`${YE}:2202`]!, fy: "2025-26", beMinor: 50000n, reMinor: 60000n, utilisedMinor: 30000n, createdBy: ADMIN_A, updatedBy: ADMIN_A }));
    await scoped(YE, (tx) => tx.insert(financeBudgets).values({ tenantId: YE, headId: heads[`${YE}:2202`]!, fy: "2026-27", beMinor: 40000n, reMinor: 40000n, utilisedMinor: 1000n, createdBy: ADMIN_A, updatedBy: ADMIN_A }));
    await scoped(YE, (tx) => tx.execute(sql`INSERT INTO gl.finance_fiscal_years (tenant_id, code, label, start_date, end_date, status, created_by) VALUES
      (${YE}::uuid, '2025-26', 'FY 2025-26', '2025-04-01', '2026-03-31', 'closed', ${ADMIN_A}::uuid),
      (${YE}::uuid, '2026-27', 'FY 2026-27', '2026-04-01', '2027-03-31', 'active', ${ADMIN_A}::uuid)`));
    for (const m of ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]) {
      await scoped(YE, (tx) => tx.execute(sql`INSERT INTO gl.finance_period_close (tenant_id, period, fiscal_year, status, closed_by, closed_at, created_by)
        VALUES (${YE}::uuid, ${m}, '2025-26', 'hard_close', ${ADMIN_A}::uuid, now(), ${ADMIN_A}::uuid)`));
    }
  });
  const tbLine = (tb: { lines: Array<Record<string, string>> }, code: string) => tb.lines.find((l) => l.code === code);

  it("the 2026-27 trial balance is FY-bounded even before any close: no 2025-26 income / expenditure, their net on the fund", async () => {
    const tb = (await call("GET", "/v1/finance/statements/trial-balance-check?fy=2026-27", as(YE, ADMIN_A))).json();
    expect(tb.isBalanced).toBe(true);
    expect(tb.openingSource).toBe("derived");
    expect(tbLine(tb, "4100")).toBeUndefined();
    expect(tbLine(tb, "2202")).toMatchObject({ openingMinor: "0", periodDebitMinor: "1000", closingMinor: "1000" });
    expect(tbLine(tb, "1100")).toMatchObject({ openingMinor: "75000", closingMinor: "74000" });
    expect(tbLine(tb, "8443")).toMatchObject({ openingMinor: "-5000", carryForward: true });
    expect(tbLine(tb, "3100")).toMatchObject({ openingMinor: "-70000" });
  });
  it("refuses the year-end close while a month of the year is not hard-closed (409 FY_OPEN_PERIODS), and for a finance officer", async () => {
    const r = await call("POST", "/v1/finance/year-end/2026-27/close", as(YE, ADMIN_A), REASON);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("FY_OPEN_PERIODS");
    expect((await call("POST", "/v1/finance/year-end/2025-26/close", as(YE, OFFICER, ["finance_officer"]), REASON)).statusCode).toBe(403);
  });
  it("the close generates opening balances for carry-forward heads only, records the lapse, and is idempotent + audited", async () => {
    expect((await call("POST", "/v1/finance/year-end/2025-26/close", as(YE, ADMIN_A), REASON)).statusCode).toBe(202);
    await deliver();
    const ob = async () => (await rows<{ account_code: string; debit_minor: string; credit_minor: string; source: string }>(YE, sql`SELECT account_code, debit_minor::text, credit_minor::text, source FROM gl.finance_opening_balances WHERE tenant_id = ${YE}::uuid AND fy_code = '2026-27' ORDER BY account_code`));
    const first = await ob();
    expect(first).toEqual([
      { account_code: "1100", debit_minor: "75000", credit_minor: "0", source: "fy_close" },
      { account_code: "3100", debit_minor: "0", credit_minor: "70000", source: "fy_close" },
      { account_code: "8443", debit_minor: "0", credit_minor: "5000", source: "fy_close" },
    ]);
    expect((await call("POST", "/v1/finance/year-end/2025-26/close", as(YE, ADMIN_B), REASON)).statusCode).toBe(202);
    await deliver();
    expect(await ob()).toEqual(first);
    const status = (await call("GET", "/v1/finance/year-end/2025-26", as(YE, OFFICER, ["finance_officer"]))).json();
    expect(status).toMatchObject({ status: "done", nextFiscalYear: "2026-27", runCount: 2, openingBalanceCount: 3, fundCarriedMinor: "70000", lapseTotalMinor: "30000" });
    const a = await audits(YE, "year_end_close");
    expect(a.map((x) => x.openingBalancesChanged)).toEqual([true, false]);
    expect(dlq.filter((m) => (m as { type?: string }).type === COMMANDS.yearEndClose)).toHaveLength(0);
    const tb = (await call("GET", "/v1/finance/statements/trial-balance-check?fy=2026-27", as(YE, ADMIN_A))).json();
    expect(tb).toMatchObject({ isBalanced: true, openingSource: "stored" });
    const bs = (await call("GET", "/v1/finance/statements/balance-sheet?fy=2026-27", as(YE, ADMIN_A))).json();
    expect(bs.balanceCheck.balanced).toBe(true);
    expect(bs.surplusDeficitMinor).toBe("-1000");
    expect(bs.totals.totalAssetsMinor).toBe("74000");
  });
  it("the 31 March lapse statement: final grant - expenditure lapses (re-appropriation / supplementary included)", async () => {
    const ls = (await call("GET", "/v1/finance/budgets/lapse-statement?fy=2025-26", as(YE, OFFICER, ["finance_officer"]))).json();
    expect(ls.recorded).not.toBeNull();
    expect(ls.rows).toEqual([expect.objectContaining({ headCode: "2202", beMinor: "50000", reMinor: "60000", reappropriationNetMinor: "10000", expenditureMinor: "30000", lapseMinor: "30000", excessMinor: "0" })]);
    const live = (await call("GET", "/v1/finance/budgets/lapse-statement?fy=2026-27", as(YE, OFFICER, ["finance_officer"]))).json();
    expect(live.recorded).toBeNull();
    expect(live.totals.lapseMinor).toBe("39000");
  });
  it("GET /budgets honours ?fy= and shows the closed year as lapsed", async () => {
    const y1 = (await call("GET", "/v1/finance/budgets?fy=2025-26", as(YE, OFFICER, ["finance_officer"]))).json();
    const y2 = (await call("GET", "/v1/finance/budgets?fy=2026-27", as(YE, OFFICER, ["finance_officer"]))).json();
    const list = (b: unknown) => (Array.isArray(b) ? b : (b as { data: unknown[] }).data) as Array<{ financialYear: string; status: string }>;
    expect(list(y1).map((b) => [b.financialYear, b.status])).toEqual([["2025-26", "lapsed"]]);
    expect(list(y2).map((b) => [b.financialYear, b.status])).toEqual([["2026-27", "active"]]);
  });
  it("the ledger shows opening and closing balances per month; an expenditure head starts the year at zero", async () => {
    const cash = (await call("GET", "/v1/finance/ledger/balances?headId=1100&fy=2026-27", as(YE, OFFICER, ["finance_officer"]))).json();
    expect(cash).toMatchObject({ openingMinor: "75000", closingMinor: "74000", head: { carryForward: true } });
    expect(cash.periods.find((p: { period: string }) => p.period === "2026-05")).toEqual({ period: "2026-05", openingMinor: "75000", debitMinor: "0", creditMinor: "1000", closingMinor: "74000" });
    expect(cash.periods.find((p: { period: string }) => p.period === "2026-06").openingMinor).toBe("74000");
    const edu = (await call("GET", `/v1/finance/ledger/balances?headId=${heads[`${YE}:2202`]}&fy=2026-27`, as(YE, OFFICER, ["finance_officer"]))).json();
    expect(edu).toMatchObject({ openingMinor: "0", closingMinor: "1000", head: { carryForward: false } });
  });
});

describe("#2464 review blocker 1: a closed financial year takes no reopen and no posting", () => {
  const fyRow = (t: string, code: string, status: string) => scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_fiscal_years (tenant_id, code, label, start_date, end_date, status, created_by)
    VALUES (${t}::uuid, ${code}, ${`FY ${code}`}, ${`${code.slice(0, 4)}-04-01`}::date, ${`${Number(code.slice(0, 4)) + 1}-03-31`}::date, ${status}, ${ADMIN_A}::uuid)`));
  const rejected = async (t: string, journalId: string) => ((await scoped(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "finance.gl.rejected"))))) as Array<{ payload: Record<string, unknown> }>)
    .filter((r) => r.payload.journalId === journalId).map((r) => r.payload.code);
  const receipt = (t: string, id: string, postingDate: string) => ({ topic: COMMANDS.journalPost, env: { messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: t, actorId: ADMIN_A, correlationId: "b19-fyc", schemaVersion: "1.0",
    payload: { id, tenantId: t, voucherNo: `FYC-${id.slice(0, 8)}`, type: "receipt", postingDate, lines: [{ accountCode: "1100", debitMinor: "500", creditMinor: "0" }, { accountCode: "4100", debitMinor: "0", creditMinor: "500" }] } } });

  it("a month of a closed FY (its year-end close has run) cannot be reopened: 409 FY_CLOSED", async () => {
    const r = await call("POST", "/v1/finance/periods/2025-06/reopen", as(YE, ADMIN_A), REASON);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("FY_CLOSED");
    await deliver();
    expect(await periodStatus(YE, "2025-06")).toBe("hard_close");
  });

  it("a pending reopen request whose FY closed meanwhile: the approval is refused (409 FY_CLOSED), and the consumer records a rejection", async () => {
    const P = "2024-05";
    expect((await call("POST", `/v1/finance/periods/${P}/hard-close`, as(MC, ADMIN_A), REASON)).statusCode).toBe(202);
    await deliver();
    const req = await call("POST", `/v1/finance/periods/${P}/reopen`, as(MC, ADMIN_A), REASON);
    expect(req.json().status).toBe("pending_approval");
    await deliver();
    await fyRow(MC, "2024-25", "closed");
    const ap = await call("POST", `/v1/finance/change-requests/${req.json().id}/approve`, as(MC, ADMIN_B), {});
    expect(ap.statusCode).toBe(409);
    expect(ap.json().code).toBe("FY_CLOSED");
    // a decision that reaches the consumer anyway (published another way) is a recorded rejection, nothing reopened
    sent.push({ topic: COMMANDS.changeRequestDecide, env: { messageId: randomUUID(), type: COMMANDS.changeRequestDecide, tenantId: MC, actorId: ADMIN_B, correlationId: "b19-fyc-cr", schemaVersion: "1.0",
      payload: { requestId: req.json().id, tenantId: MC, decision: "approve", note: null } } });
    await deliver();
    const [cr] = await rows<{ status: string; decision_note: string }>(MC, sql`SELECT status, decision_note FROM gl.finance_change_requests WHERE id = ${req.json().id}::uuid`);
    expect(cr!.status).toBe("rejected");
    expect(cr!.decision_note).toMatch(/closed/);
    expect(await periodStatus(MC, P)).toBe("hard_close");
    expect((await audits(MC, "reopen")).filter((a) => a.resourceId === P)).toHaveLength(0);
  });

  it("posting into any month of a closed FY is refused FY_CLOSED (route and consumer), also when only its year-end close has run", async () => {
    await fyRow(DIRECT, "2023-24", "closed");
    const res = await call("POST", "/v1/finance/journals", { ...as(DIRECT, OFFICER, ["finance_officer"]), "x-idempotency-key": randomUUID() },
      { type: "receipt", postingDate: "2023-07-10", lines: [{ accountCode: "1100", debitMinor: "500", creditMinor: "0" }, { accountCode: "4100", debitMinor: "0", creditMinor: "500" }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FY_CLOSED");
    const a = randomUUID();
    sent.push(receipt(DIRECT, a, "2023-07-10"));
    await deliver();
    expect(await scoped(DIRECT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, a)))).toHaveLength(0);
    expect(await rejected(DIRECT, a)).toEqual(["FY_CLOSED"]);
    // no fiscal-year row at all, but a year-end close has run for 2022-23
    await scoped(DIRECT, (tx) => tx.execute(sql`INSERT INTO gl.finance_year_end_runs (tenant_id, fy_code, next_fy_code, reason, run_by) VALUES (${DIRECT}::uuid, '2022-23', '2023-24', 'test run', ${ADMIN_A}::uuid)`));
    const b = randomUUID();
    sent.push(receipt(DIRECT, b, "2022-07-10"));
    await deliver();
    expect(await rejected(DIRECT, b)).toEqual(["FY_CLOSED"]);
  });
});

describe("#2464 review: lapse statement expenditure is the ledger figure, the same as Budget Monitoring", () => {
  it("a reversal / recovery credit reduces the expenditure (utilised_minor does not); lapse statement and monitoring agree", async () => {
    await scoped(YE, (tx) => tx.insert(financeBudgetAllocation).values({ tenantId: YE, headId: heads[`${YE}:2202`]!, fy: "2026-27", allocatedMinor: 40000n, createdBy: ADMIN_A, updatedBy: ADMIN_A }));
    // Rs 4 of the Rs 10 spent on 2202 in 2026-27 is recovered (Cr 2202 / Dr cash)
    await ledger(YE, "1100", 400n, 0n, "2026-06-10"); await ledger(YE, "2202", 0n, 400n, "2026-06-10");
    const ls = (await call("GET", "/v1/finance/budgets/lapse-statement?fy=2026-27", as(YE, OFFICER, ["finance_officer"]))).json();
    const row = ls.rows.find((r: { headCode: string }) => r.headCode === "2202");
    expect(row).toMatchObject({ expenditureMinor: "600", lapseMinor: "39400" });
    const mon = (await call("GET", "/v1/finance/budget-monitoring?fy=2026-27", as(YE, OFFICER, ["finance_officer"]))).json();
    const line = mon.lines.find((l: { headCode: string }) => l.headCode === "2202");
    expect(line.actualMinor).toBe(row.expenditureMinor);
    // the budget control figure is unchanged (it is never released by a reversal)
    const [b] = await scoped(YE, (tx) => tx.select().from(financeBudgets).where(and(eq(financeBudgets.headId, heads[`${YE}:2202`]!), eq(financeBudgets.fy, "2026-27"))));
    expect(b!.utilisedMinor).toBe(1000n);
  });
});
