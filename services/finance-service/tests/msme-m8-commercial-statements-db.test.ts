/**
 * MSME M8, REAL Postgres (the orchestrator's gate runs this on a throwaway database). Needs migrations through 0173.
 * A company tenant renders Schedule III P&L / BS / CF, a proprietorship tenant renders Trading + P&L + BS, both over the FULL
 * seeded commercial chart classified by the stored statement_class; the selector keys on the stored entity_type; govt / nonprofit
 * tenants see no commercial statements and their set-for-tenant payload is unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { buildApp } from "../src/app.js";
import { bearer } from "./_fp02.js";

const ACTOR = "00000000-0f71-4000-8000-0000000000a1";
const tenants: string[] = [];
let prevFlag: string | undefined;
beforeAll(() => { prevFlag = process.env.TENANT_PROFILES_ENABLED; process.env.TENANT_PROFILES_ENABLED = "true"; });
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of tenants) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await sqlClient.end();
});

// FY 2026-27 commercial books (paise): capital, fixed asset, credit sale with GST, purchase with ITC, depreciation, rent, interest, loan.
const VOUCHERS: Array<[string, Array<[string, bigint, bigint]>]> = [
  ["V1", [["1100", 1000000n, 0n], ["3000", 0n, 1000000n]]],
  ["V2", [["1200", 300000n, 0n], ["1100", 0n, 300000n]]],
  ["V3", [["1300", 590000n, 0n], ["4010", 0n, 500000n], ["2300", 0n, 90000n]]],
  ["V4", [["5400", 200000n, 0n], ["1700", 36000n, 0n], ["2050", 0n, 236000n]]],
  ["V5", [["5100", 30000n, 0n], ["1250", 0n, 30000n]]],
  ["V6", [["5410", 50000n, 0n], ["1100", 0n, 50000n]]],
  ["V7", [["1100", 10000n, 0n], ["4400", 0n, 10000n]]],
  ["V8", [["1100", 100000n, 0n], ["2400", 0n, 100000n]]],
];

async function seed(o: { template: "commercial" | "govt"; entityType?: string | null; ledger?: boolean }) {
  const t = randomUUID(); tenants.push(t);
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, accounting_basis, entity_type, updated_by)
    VALUES (${t}::uuid, ${o.template}, ${o.template === "commercial" ? "accrual" : "cash"}, ${o.entityType ?? null}, ${ACTOR}::uuid)`));
  if (o.template === "commercial") {
    await scoped(t, (tx) => seedGlHeadsTx(tx, t, "commercial"));
    if (o.ledger !== false) {
      const heads = new Map((await scoped(t, (tx) => tx.select({ id: financeHeads.id, code: financeHeads.code }).from(financeHeads).where(eq(financeHeads.tenantId, t)))).map((h) => [h.code, h.id]));
      const rows = VOUCHERS.flatMap(([v, ls]) => ls.map(([code, d, c]) => ({
        tenantId: t, headId: heads.get(code) as string, voucherNo: v, postingDate: "2026-08-10", debitMinor: d, creditMinor: c, balanceMinor: d - c, createdBy: ACTOR, updatedBy: ACTOR,
      })));
      await scoped(t, (tx) => tx.insert(financeLedger).values(rows));
    }
  }
  return t;
}
const get = async (app: Awaited<ReturnType<typeof buildApp>>, t: string, url: string) => {
  const res = await app.inject({ method: "GET", url, headers: bearer(t, ACTOR, ["finance_officer"]) });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
};
const B = "/v1/finance/statements";

describe("company tenant -> Schedule III", () => {
  it("renders P&L, Balance Sheet and Cash Flow from the seeded commercial chart; 2300 GST Payable is a current liability", async () => {
    const app = await buildApp();
    try {
      const t = await seed({ template: "commercial", entityType: "company" });
      const all = await get(app, t, `${B}/commercial/set?fy=2026-27`);
      expect(all.status).toBe(200);
      expect(all.body.family).toBe("schedule_iii");
      expect(all.body.framework).toBe("as");
      expect(all.body.profitAndLoss.profitAfterTaxMinor).toBe("230000");
      const bs = all.body.balanceSheet;
      expect(bs.balanced).toBe(true);
      expect(bs.totalAssetsMinor).toBe("1656000");
      const cl = bs.equityAndLiabilities.find((g: any) => g.key === "current_liabilities");
      expect(cl.lines.find((l: any) => l.code === "2300")).toMatchObject({ amountMinor: "90000" });
      expect(bs.assets.find((g: any) => g.key === "current_assets").lines.map((l: any) => l.code)).not.toContain("2300");
      expect(all.body.cashFlow).toMatchObject({ reconciles: true, closingCashMinor: "760000", netOperatingMinor: "-40000", netInvestingMinor: "-300000", netFinancingMinor: "1100000" });
      expect(all.body.tradingAccount).toBeUndefined();
      expect((await get(app, t, `${B}/commercial/cash-flow?fy=2026-27`)).status).toBe(200);
      expect((await get(app, t, `${B}/commercial/trading-account?fy=2026-27`)).status).toBe(404);
      const sel = await get(app, t, `${B}/set-for-tenant`);
      expect(sel.body).toMatchObject({ coaTemplate: "commercial", entityType: "company", id: "commercial", family: "schedule_iii", available: true });
    } finally { await app.close(); }
  });

  it("a head with a balance but no stored statement_class refuses the statement (409), never guessed from the code", async () => {
    const app = await buildApp();
    try {
      const t = await seed({ template: "commercial", entityType: "company" });
      await scoped(t, (tx) => tx.execute(sql`UPDATE budget.finance_heads SET statement_class = NULL WHERE tenant_id = ${t}::uuid AND code = '2300'`));
      const r = await get(app, t, `${B}/commercial/balance-sheet?fy=2026-27`);
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body)).toContain("STATEMENT_CLASS_MISSING");
    } finally { await app.close(); }
  });
});

describe("proprietorship tenant -> Trading + P&L + Balance Sheet", () => {
  it("same books, ITR family: gross profit 3,00,000, net profit 2,30,000, balanced, no cash-flow", async () => {
    const app = await buildApp();
    try {
      const t = await seed({ template: "commercial", entityType: "proprietorship" });
      const all = await get(app, t, `${B}/commercial/set?fy=2026-27`);
      expect(all.status).toBe(200);
      expect(all.body.family).toBe("trading_pl_bs");
      expect(all.body.tradingAccount.grossProfitMinor).toBe("300000");
      expect(all.body.profitAndLoss.netProfitMinor).toBe("230000");
      expect(all.body.balanceSheet.balanced).toBe(true);
      expect(all.body.cashFlow).toBeUndefined();
      expect((await get(app, t, `${B}/commercial/cash-flow?fy=2026-27`)).status).toBe(404);
    } finally { await app.close(); }
  });
  it("LLP routes to the AS-based family with the Form 8/11 v2 marker", async () => {
    const app = await buildApp();
    try {
      const t = await seed({ template: "commercial", entityType: "llp" });
      const all = await get(app, t, `${B}/commercial/set?fy=2026-27`);
      expect(all.body.family).toBe("schedule_iii");
      expect(all.body.markers.llpForm8Form11).toBe("v2");
    } finally { await app.close(); }
  });
});

describe("selector keys on the stored entity_type; other templates see nothing", () => {
  it("commercial with no entity_type -> 404; govt tenant -> 404 and set-for-tenant payload has no commercial keys", async () => {
    const app = await buildApp();
    try {
      const noType = await seed({ template: "commercial", entityType: null, ledger: false });
      expect((await get(app, noType, `${B}/commercial/set?fy=2026-27`)).status).toBe(404);
      const govt = await seed({ template: "govt" });
      expect((await get(app, govt, `${B}/commercial/balance-sheet?fy=2026-27`)).status).toBe(404);
      const sel = await get(app, govt, `${B}/set-for-tenant`);
      expect(Object.keys(sel.body).sort()).toEqual(["available", "coaTemplate", "fundWise", "id", "requiresFundAccounting", "statements"]);
    } finally { await app.close(); }
  });
});
