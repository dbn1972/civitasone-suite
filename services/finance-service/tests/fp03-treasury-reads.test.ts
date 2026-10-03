/**
 * Finish batch fp-finance-03 -- read/guard paths against a real DB:
 *  - DEPOSITS-03   GET /v1/finance/deposits/:id (deposit + ledger events, tenant scoped)
 *  - CASH-BANK-05  cash-book rows carry journal_id when a GL voucher exists
 *  - GST-05        GST ledger rows flag invoice_is_bill only for a real bill of the tenant
 *  - JOURNAL-04    control accounts: listed with isControl, refused for manual journals
 *  - OUTCOME-02    indicator polarity: DB check, create validation, scoring in the list payload
 *  - DASHBOARD-06  MIS CSV export
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { assertNoControlAccounts } from "../src/modules/gl/domain.js";
import { findControlAccountRefs, findControlAccountRefsTx } from "../src/modules/budget/repo.js";
import { buildMisCsv, paiseToRupeesString, misFileName } from "../src/modules/dashboard/mis.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000003e1";
const OTHER = "aaaaaaaa-1111-4000-8000-0000000003e2";
const ACTOR = "00000000-aaaa-4000-8000-0000000003e1";
const token = (roles: string[], tid = TENANT) => signToken({ sub: ACTOR, tid, roles, sid: "sess-fp03-reads" }, SECRET);
const auth = (roles = ["finance_officer"], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

const DEPOSIT = "dddddddd-4444-4000-8000-0000000003e1";
const HEAD_CTL = "cccccccc-4444-4000-8000-0000000003e1";
const HEAD_OK = "cccccccc-4444-4000-8000-0000000003e2";
const BILL = "bbbbbbbb-4444-4000-8000-0000000003e1";
const JOURNAL = "aaaaaaaa-4444-4000-8000-0000000003e1";

async function rows(tenant: string, q: ReturnType<typeof sql>): Promise<any[]> {
  return scoped(tenant, async (tx) => { const r: any = await tx.execute(q); return Array.isArray(r) ? r : r.rows ?? []; });
}
async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    for (const stmt of [
      sql`DELETE FROM treasury.finance_deposit_events WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM treasury.finance_deposits WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM gl.finance_cash_book WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM gl.finance_gst_ledger WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM payments.finance_bills WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM gl.finance_journals WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM budget.finance_budget_outcomes WHERE tenant_id = ${t}::uuid`,
      sql`DELETE FROM budget.finance_heads WHERE tenant_id = ${t}::uuid`,
    ]) {
      // The ledger tables are append-only for the app role (no DELETE grant): skip those, the fixtures are idempotent.
      try { await scoped(t, (tx) => tx.execute(stmt)); } catch (e) { if (!/permission denied/.test(String(e))) throw e; }
    }
  }
}
beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, is_control, created_by, updated_by) VALUES
      (${HEAD_CTL}::uuid, ${TENANT}::uuid, '2300', 'Creditors Control', 0, 'liability', true, ${ACTOR}::uuid, ${ACTOR}::uuid),
      (${HEAD_OK}::uuid, ${TENANT}::uuid, '1100', 'Cash', 0, 'asset', false, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO treasury.finance_deposits (id, tenant_id, pd_no, type, administrator, balance_minor, created_by, updated_by)
    VALUES (${DEPOSIT}::uuid, ${TENANT}::uuid, 'PD-1', 'emd', 'Collector', 5000, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO treasury.finance_deposit_events (tenant_id, deposit_id, event_type, amount_minor, reference, created_by)
    VALUES (${TENANT}::uuid, ${DEPOSIT}::uuid, 'refund', 1000, 'REF-1', ${ACTOR}::uuid)`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_journals (id, tenant_id, voucher_no, type, posting_date, created_by, updated_by)
    VALUES (${JOURNAL}::uuid, ${TENANT}::uuid, 'RCPT/0001', 'receipt', '2026-09-01', ${ACTOR}::uuid, ${ACTOR}::uuid)
    ON CONFLICT DO NOTHING`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_cash_book (tenant_id, entry_date, voucher_type, voucher_no, particulars, receipt_minor, payment_minor, balance_minor, bank_or_cash)
    VALUES (${TENANT}::uuid, '2026-09-01', 'receipt', 'RCPT/0001', 'Fee', 500, 0, 500, 'cash'),
           (${TENANT}::uuid, '2026-09-02', 'receipt', 'NO-JOURNAL', 'Orphan', 100, 0, 600, 'cash')`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO payments.finance_bills (id, tenant_id, bill_no, vendor_id, head_id, gross_minor, net_minor, currency, deductions, stage, status, created_by, updated_by)
    VALUES (${BILL}::uuid, ${TENANT}::uuid, 'B-1', gen_random_uuid(), ${HEAD_OK}::uuid, 1000, 1000, 'INR', '[]'::jsonb, 'section', 'pending', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_gst_ledger (tenant_id, invoice_id, invoice_no, invoice_date, gst_type, direction, taxable_minor, tax_minor, rate_pct, period, created_by)
    VALUES (${TENANT}::uuid, ${BILL}::uuid, 'INV-BILL', '2026-09-03', 'CGST', 'input', 1000, 90, 9, '2026-09', ${ACTOR}::uuid),
           (${TENANT}::uuid, gen_random_uuid(), 'INV-OTHER', '2026-09-03', 'CGST', 'output', 1000, 90, 9, '2026-09', ${ACTOR}::uuid),
           (${TENANT}::uuid, NULL, 'INV-NONE', '2026-09-03', 'CGST', 'output', 1000, 90, 9, '2026-09', ${ACTOR}::uuid)`));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/finance/deposits/:id (DEPOSITS-03)", () => {
  it("returns the deposit with its ledger events; 404 for another tenant or an unknown id", async () => {
    const app = await buildApp();
    try {
      const ok = await app.inject({ method: "GET", url: `/v1/finance/deposits/${DEPOSIT}`, headers: auth(["audit_officer"]) });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data).toMatchObject({ pdNo: "PD-1", balanceMinor: "5000", status: "active" });
      expect(ok.json().data.events).toMatchObject([{ eventType: "refund", amountMinor: "1000", reference: "REF-1" }]);
      expect((await app.inject({ method: "GET", url: `/v1/finance/deposits/${DEPOSIT}`, headers: auth(["finance_officer"], OTHER) })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/v1/finance/deposits/${randomUUID()}`, headers: auth() })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/v1/finance/deposits/${DEPOSIT}`, headers: auth(["procurement_officer"]) })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});

describe("cash book voucher link (CASH-BANK-05)", () => {
  it("adds journal_id only where a GL voucher with that number exists", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/cash-book", headers: auth() });
      expect(res.statusCode).toBe(200);
      const byNo = Object.fromEntries((res.json().data as any[]).map((r) => [r.voucher_no, r.journal_id]));
      expect(byNo["RCPT/0001"]).toBe(JOURNAL);
      expect(byNo["NO-JOURNAL"]).toBeNull();
    } finally { await app.close(); }
  });
});

describe("GST ledger invoice link (GST-05)", () => {
  it("flags invoice_is_bill only for a real bill of this tenant", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/gst/ledger?period=2026-09", headers: auth() });
      expect(res.statusCode).toBe(200);
      const byNo = Object.fromEntries((res.json().data as any[]).map((r) => [r.invoice_no, r.invoice_is_bill]));
      expect(byNo).toEqual({ "INV-BILL": true, "INV-OTHER": false, "INV-NONE": false });
    } finally { await app.close(); }
  });
});

describe("control accounts (JOURNAL-04)", () => {
  it("assertNoControlAccounts passes an empty set and rejects a non-empty one", () => {
    expect(() => assertNoControlAccounts([])).not.toThrow();
    expect(() => assertNoControlAccounts(["2300"])).toThrow(/control account/);
  });
  it("findControlAccountRefs matches by code or id, only control heads, tenant-scoped", async () => {
    const hit = await scoped(TENANT, (tx) => findControlAccountRefsTx(tx as never, TENANT, ["2300", HEAD_CTL, "1100", "9999"]));
    expect(hit.sort()).toEqual([HEAD_CTL, "2300"].sort());
    expect(await scoped(OTHER, (tx) => findControlAccountRefsTx(tx as never, OTHER, ["2300"]))).toEqual([]);
    expect(await findControlAccountRefs(TENANT, [])).toEqual([]);
  });
  it("/accounts exposes isControl and a manual journal to a control account is refused with 400", async () => {
    const app = await buildApp();
    try {
      const list = await app.inject({ method: "GET", url: "/v1/finance/accounts", headers: auth() });
      const byCode = Object.fromEntries((list.json().data as any[]).map((a) => [a.code, a.isControl]));
      expect(byCode).toMatchObject({ "2300": true, "1100": false });
      const line = (accountCode: string, debitMinor: string, creditMinor: string) => ({ accountCode, debitMinor, creditMinor });
      const bad = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: auth(),
        payload: { type: "journal", postingDate: "2026-09-10", lines: [line("1100", "100", "0"), line("2300", "0", "100")] },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe("CONTROL_ACCOUNT");
      const good = await app.inject({
        method: "POST", url: "/v1/finance/journals", headers: auth(),
        payload: { type: "journal", postingDate: "2026-09-10", lines: [line("1100", "100", "0"), line("1100", "0", "100")] },
      });
      expect(good.statusCode).toBe(202);
    } finally { await app.close(); }
  });
});

describe("outcome indicator polarity (OUTCOME-02)", () => {
  const insert = (id: string, polarity: string, baseline: number, target: number, achieved: number, recorded: boolean) =>
    scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO budget.finance_budget_outcomes
        (id, tenant_id, head_id, fy, output_desc, outcome_desc, indicator, unit, polarity, baseline_value, target_value, achieved_value, achievement_recorded, status, effective_from, created_by, updated_by)
      VALUES (${id}::uuid, ${TENANT}::uuid, ${HEAD_OK}::uuid, '2026-27', 'out', 'outcome', 'Days to settle', 'days', ${polarity}, ${baseline}, ${target}, ${achieved}, ${recorded}, 'active', '2026-04-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`));

  it("the DB refuses a baseline on the wrong side of the target for the polarity", async () => {
    await expect(insert(randomUUID(), "lower_is_better", 10, 30, 0, false)).rejects.toThrow(/baseline_vs_target|violates check/);
    await expect(insert(randomUUID(), "higher_is_better", 60, 30, 0, false)).rejects.toThrow(/baseline_vs_target|violates check/);
    await expect(insert(randomUUID(), "sideways", 10, 30, 0, false)).rejects.toThrow(/polarity_chk|violates check/);
  });

  it("scores a lower-is-better indicator correctly and reports an unmeasured one as blank", async () => {
    const over = randomUUID(); const half = randomUUID(); const unmeasured = randomUUID(); const higher = randomUUID();
    await insert(over, "lower_is_better", 60, 30, 20, true);       // overshoots the target
    await insert(half, "lower_is_better", 60, 30, 45, true);
    await insert(unmeasured, "lower_is_better", 60, 30, 0, false);  // 0 is the BEST value, but nothing recorded
    await insert(higher, "higher_is_better", 0, 100, 25, true);
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/budget-outcomes", headers: auth() });
      const by = Object.fromEntries((res.json().data as any[]).map((o) => [o.id, o]));
      expect(by[over]).toMatchObject({ polarity: "lower_is_better", achievementBps: "10000" });
      expect(by[half].achievementBps).toBe("5000");
      expect(by[unmeasured].achievementBps).toBe("");
      expect(by[higher]).toMatchObject({ polarity: "higher_is_better", achievementBps: "2500" });
    } finally { await app.close(); }
  });

  it("POST validates the polarity/baseline relationship synchronously", async () => {
    const app = await buildApp();
    try {
      const body = (extra: Record<string, unknown>) => ({
        headId: HEAD_OK, fy: "2026-27", outputDesc: "Faster settlement", outcomeDesc: "Citizens wait less", indicator: "Days", unit: "days", targetValue: 30, ...extra,
      });
      const post = (b: unknown) => app.inject({ method: "POST", url: "/v1/finance/budget-outcomes", headers: auth(), payload: b as any });
      expect((await post(body({ polarity: "lower_is_better", baselineValue: 10 }))).json().code).toBe("INVALID_OUTCOME");
      expect((await post(body({ polarity: "lower_is_better", baselineValue: 60 }))).statusCode).toBe(202);
      expect((await post(body({ baselineValue: 60 }))).json().code).toBe("INVALID_OUTCOME");
    } finally { await app.close(); }
  });
});

describe("MIS export (DASHBOARD-06)", () => {
  it("formats paise as rupees without float error", () => {
    expect(paiseToRupeesString(12345n)).toBe("123.45");
    expect(paiseToRupeesString(5n)).toBe("0.05");
    expect(paiseToRupeesString(9007199254740993n)).toBe("90071992547409.93");
  });
  it("builds a CSV with blank (not zero) for unknown figures and the FY in the file name", () => {
    const csv = buildMisCsv("2026-27", { budgetUtilisationPct: null, pendingSanctions: 2, paymentsThisMonth: 3, totalExpenditure: 150000 }, "2026-10-03T00:00:00.000Z");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Section,Metric,Value,Unit");
    expect(lines).toContain("Budget,Budget utilisation,,percent");
    expect(lines).toContain("Budget,Budget estimate (BE),,INR");
    expect(lines).toContain("Expenditure,Expenditure (FY to date),1500.00,INR");
    expect(lines).toContain("Approvals,Pending sanctions,2,count");
    expect(misFileName("2026-27")).toBe("finance-mis-2026-27.csv");
  });
  it("GET serves the CSV as an attachment for finance roles and rejects a bad FY and other roles", async () => {
    const app = await buildApp();
    try {
      const ok = await app.inject({ method: "GET", url: "/v1/finance/dashboard/mis-export?fy=2026-27", headers: auth(["budget_officer"]) });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers["content-type"]).toMatch(/text\/csv/);
      expect(ok.headers["content-disposition"]).toContain("finance-mis-2026-27.csv");
      expect(ok.body.split("\r\n")[0]).toBe("Section,Metric,Value,Unit");
      expect((await app.inject({ method: "GET", url: "/v1/finance/dashboard/mis-export?fy=2026-28", headers: auth() })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/v1/finance/dashboard/mis-export?fy=2026-27", headers: auth(["procurement_officer"]) })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
