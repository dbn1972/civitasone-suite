/**
 * PSU v1-A, REAL Postgres (the orchestrator's gate runs this on a throwaway database). Needs migrations through 0186.
 * A company tenant renders SOCIE (ties to the BS equity section) + a P&L prior-year column; the per-tenant accounting_standard
 * (set only through the maker-checker route) drives markers.framework; an unset tenant falls back to the deployment default.
 */
import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { registerApprovalsConsumers } from "../src/modules/approvals/consumer.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const MAKER = "00000000-0f71-4000-8000-0000000000b1";
const CHECKER = "00000000-0f71-4000-8000-0000000000b2";
const tenants: string[] = [];
let prevFlag: string | undefined; let prevStd: string | undefined;
beforeAll(() => { prevFlag = process.env.TENANT_PROFILES_ENABLED; process.env.TENANT_PROFILES_ENABLED = "true"; prevStd = process.env.FINANCE_COMMERCIAL_ACCOUNTING_STANDARD; });
afterEach(() => { vi.restoreAllMocks(); if (prevStd === undefined) delete process.env.FINANCE_COMMERCIAL_ACCOUNTING_STANDARD; else process.env.FINANCE_COMMERCIAL_ACCOUNTING_STANDARD = prevStd; });
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of tenants) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await sqlClient.end();
});

const hdr = (t: string, sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: t, roles, sid: `s-${sub.slice(-3)}` }, SECRET)}` });
// [voucher, posting date, lines [code, dr, cr]]. FY 2025-26 = prior year, FY 2026-27 = current.
const VOUCHERS: Array<[string, string, Array<[string, bigint, bigint]>]> = [
  ["P1", "2025-06-10", [["1100", 500000n, 0n], ["3000", 0n, 500000n]]],
  ["P2", "2025-08-10", [["1100", 400000n, 0n], ["4010", 0n, 400000n]]],
  ["P3", "2025-09-10", [["5400", 100000n, 0n], ["1100", 0n, 100000n]]],
  ["C1", "2026-08-10", [["1100", 700000n, 0n], ["4010", 0n, 700000n]]],
  ["C2", "2026-09-10", [["5400", 200000n, 0n], ["1100", 0n, 200000n]]],
  ["C3", "2026-10-10", [["1100", 50000n, 0n], ["3200", 0n, 50000n]]],
  ["C4", "2026-11-10", [["3200", 20000n, 0n], ["1100", 0n, 20000n]]],
];
async function seed(o: { template: "commercial" | "govt"; accountingStandard?: string | null }) {
  const t = randomUUID(); tenants.push(t);
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, accounting_basis, entity_type, accounting_standard, maker_checker_enabled, updated_by)
    VALUES (${t}::uuid, ${o.template}, ${o.template === "commercial" ? "accrual" : "cash"}, ${o.template === "commercial" ? "company" : null}, ${o.accountingStandard ?? null}, true, ${MAKER}::uuid)`));
  if (o.template === "commercial") {
    await scoped(t, (tx) => seedGlHeadsTx(tx, t, "commercial"));
    const heads = new Map((await scoped(t, (tx) => tx.select({ id: financeHeads.id, code: financeHeads.code }).from(financeHeads).where(eq(financeHeads.tenantId, t)))).map((h) => [h.code, h.id]));
    const rows = VOUCHERS.flatMap(([v, d, ls]) => ls.map(([code, dr, cr]) => ({
      tenantId: t, headId: heads.get(code) as string, voucherNo: v, postingDate: d, debitMinor: dr, creditMinor: cr, balanceMinor: dr - cr, createdBy: MAKER, updatedBy: MAKER,
    })));
    await scoped(t, (tx) => tx.insert(financeLedger).values(rows));
  }
  return t;
}
const get = async (t: string, url: string) => {
  const app = await buildApp();
  try { const r = await app.inject({ method: "GET", url, headers: hdr(t, MAKER, ["finance_officer"]) }); return { status: r.statusCode, body: r.json() as Record<string, any> }; } finally { await app.close(); }
};
const B = "/v1/finance/statements/commercial";

describe("SOCIE + P&L comparatives (company tenant)", () => {
  it("SOCIE opening -> movements -> closing ties to the Balance Sheet equity section", async () => {
    const t = await seed({ template: "commercial" });
    const r = await get(t, `${B}/changes-in-equity?fy=2026-27`);
    expect(r.status).toBe(200);
    expect(r.body.tiesToBalanceSheet).toBe(true);
    const cap = r.body.rows.find((x: any) => x.code === "3000");
    expect(cap).toMatchObject({ component: "equity_share_capital", openingMinor: "500000", closingMinor: "500000" });
    expect(r.body.rows.find((x: any) => x.code === null)).toMatchObject({ profitForYearMinor: "500000" });
    const tot = r.body.totals;
    expect(BigInt(tot.openingMinor) + BigInt(tot.profitForYearMinor) + BigInt(tot.additionsMinor) - BigInt(tot.dividendsMinor) - BigInt(tot.otherDeductionsMinor)).toBe(BigInt(tot.closingMinor));
    const bs = (await get(t, `${B}/balance-sheet?fy=2026-27`)).body;
    expect(bs.balanced).toBe(true);
    expect(r.body.balanceSheetEquityMinor).toBe(["capital", "reserves"].map((k) => bs.equityAndLiabilities.find((g: any) => g.key === k).totalMinor).reduce((a: bigint, v: string) => a + BigInt(v), 0n).toString());
    expect((await get(t, `${B}/set?fy=2026-27`)).body.changesInEquity.tiesToBalanceSheet).toBe(true);
  });
  it("P&L carries the prior-year column (2025-26 own movements)", async () => {
    const t = await seed({ template: "commercial" });
    const pl = (await get(t, `${B}/profit-and-loss?fy=2026-27`)).body;
    expect(pl.profitAfterTaxMinor).toBe("500000");
    expect(pl.priorYear).toMatchObject({ fiscalYear: "2025-26", totalRevenueMinor: "400000", totalExpensesMinor: "100000", profitAfterTaxMinor: "300000" });
    const rev = pl.groups.find((g: any) => g.key === "revenue_from_operations");
    expect(rev.lines.find((l: any) => l.code === "4010")).toMatchObject({ amountMinor: "700000", priorYearMinor: "400000" });
  });
  it("a govt tenant sees no commercial statements (SOCIE included)", async () => {
    const t = await seed({ template: "govt" });
    expect((await get(t, `${B}/changes-in-equity?fy=2026-27`)).status).toBe(404);
  });
});

describe("per-tenant accounting framework", () => {
  it("stored value drives markers.framework and overrides the env; unset falls back to the env default", async () => {
    process.env.FINANCE_COMMERCIAL_ACCOUNTING_STANDARD = "ind_as";
    const unset = await seed({ template: "commercial" });
    const stored = await seed({ template: "commercial", accountingStandard: "as" });
    expect((await get(unset, `${B}/set?fy=2026-27`)).body.markers.framework).toBe("ind_as");
    expect((await get(stored, `${B}/set?fy=2026-27`)).body.markers.framework).toBe("as");
    expect((await get(stored, `${B}/profit-and-loss?fy=2026-27`)).body.framework).toBe("as");
    delete process.env.FINANCE_COMMERCIAL_ACCOUNTING_STANDARD;
    expect((await get(unset, `${B}/set?fy=2026-27`)).body.markers.framework).toBe("as");
  });
  it("accounting_standard is settable only through maker-checker: a second admin must approve; the DB CHECK rejects other values", async () => {
    const t = await seed({ template: "commercial" });
    const sent: Array<{ topic: string; env: any }> = [];
    vi.spyOn(queue, "publish").mockImplementation(async (topic: string, env: any) => { sent.push({ topic, env }); return undefined as never; });
    const deliver = async () => {
      const q = new MemoryQueue({ maxAttempts: 1 }); const raw = q.subscribe.bind(q);
      q.subscribe = ((topic: string, h: Handler) => raw(topic, (m: Parameters<Handler>[0]) => runWithTenant(m.tenantId, () => h(m)))) as typeof q.subscribe;
      registerApprovalsConsumers(q); await q.start();
      const batch = sent.splice(0); for (const b of batch) await q.publish(b.topic, b.env as never); await q.drain();
    };
    const app = await buildApp();
    try {
      const put = await app.inject({ method: "PUT", url: "/v1/finance/settings", headers: hdr(t, MAKER, ["finance_admin"]), payload: { accountingStandard: "ind_as", reason: "Turnover crossed the Ind AS threshold" } });
      expect(put.statusCode).toBe(202);
      expect(put.json().status).toBe("pending_approval");
      await deliver();
      expect((await get(t, `${B}/set?fy=2026-27`)).body.markers.framework).toBe("as"); // unchanged until approved
      const id = put.json().id as string;
      expect((await app.inject({ method: "POST", url: `/v1/finance/change-requests/${id}/approve`, headers: hdr(t, MAKER, ["finance_admin"]), payload: {} })).statusCode).toBe(409);
      sent.length = 0;
      expect((await app.inject({ method: "POST", url: `/v1/finance/change-requests/${id}/approve`, headers: hdr(t, CHECKER, ["finance_admin"]), payload: {} })).statusCode).toBe(202);
      await deliver();
      expect((await get(t, `${B}/set?fy=2026-27`)).body.markers.framework).toBe("ind_as");
      const bad = await app.inject({ method: "PUT", url: "/v1/finance/settings", headers: hdr(t, MAKER, ["finance_admin"]), payload: { accountingStandard: "ifrs", reason: "Not a supported framework" } });
      expect(bad.statusCode).toBe(400);
      await expect(scoped(t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET accounting_standard = 'ifrs' WHERE tenant_id = ${t}::uuid`))).rejects.toThrow();
    } finally { await app.close(); }
  });
});
