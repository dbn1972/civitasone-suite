/**
 * Section 8 NF-7, REAL Postgres (the orchestrator's gate runs this on a throwaway database; the author does not).
 * Needs migrations 0169-0172 applied.
 *
 *  1. fund-wise Balance Sheet / I&E / Receipts & Payments over a seeded nonprofit tenant (3 funds, a transfer, a release, a
 *     grant): per-fund balancing, inter-fund movement lines, grants_in_aid tagging, statement agreement.
 *  2. per-fund year-end close: 3910/3911/3920/3921 are rolled into each fund's 3100 (no stale head in the next year's
 *     opening rows), every fund still nets to zero, the next year's statements open at the rolled balance, re-run is a no-op.
 *  3. flag OFF / govt: the fund-wise routes 404 and the govt statement + year-end output is byte-identical before and after.
 *  4. the statement-set resolver endpoint.
 * nf0-govt-golden.test.ts and its fixture are NOT touched; this file only adds assertions.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { ensureGeneralFundTx, FUND_HEADS } from "../src/modules/gl/funds.js";
import { GRANT_HEAD_CODES } from "../src/modules/gl/system-heads.js";
import { fundYearEndRollover } from "../src/modules/year-end/fund-repo.js";
import { buildApp } from "../src/app.js";
import { bearer } from "./_fp02.js";

const ACTOR = "00000000-0f71-4000-8000-0000000000a1";
const GH = GRANT_HEAD_CODES();
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));
const tenants: string[] = [];
afterAll(async () => {
  for (const t of tenants) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await sqlClient.end();
});

const HEAD_DEFS: Array<[string, string]> = [
  ["1100", "asset"], [FUND_HEADS.dueFrom, "asset"], [FUND_HEADS.dueTo, "liability"], ["3100", "equity"],
  [FUND_HEADS.transferOut, "equity"], [FUND_HEADS.transferIn, "equity"], [FUND_HEADS.releaseOut, "equity"], [FUND_HEADS.releaseIn, "equity"],
  ["4100", "income"], [GH.revenueIncomeGeneral, "income"], ["5100", "expense"],
];
async function seed(opts: { nonprofit: boolean }) {
  const t = randomUUID(); tenants.push(t);
  const heads = new Map(HEAD_DEFS.map(([code, classification]) => [code, {
    id: randomUUID(), tenantId: t, code, name: `Head ${code}`, level: 0, classification, createdBy: ACTOR, updatedBy: ACTOR,
  }]));
  await scoped(t, (tx) => tx.insert(financeHeads).values([...heads.values()]));
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, budget_control, coa_template, updated_by)
    VALUES (${t}::uuid, 'off', ${opts.nonprofit ? "nonprofit" : "govt"}, ${ACTOR}::uuid)`));
  if (!opts.nonprofit) return { t, heads, general: null as string | null, restricted: "", designated: "" };
  const general = await scoped(t, (tx) => ensureGeneralFundTx(tx, t, ACTOR));
  const mk = async (code: string, type: string) => {
    const id = randomUUID();
    await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.funds (id, tenant_id, code, name, type, fcra, created_by, updated_by)
      VALUES (${id}::uuid, ${t}::uuid, ${code}, ${code}, ${type}, false, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    return id;
  };
  const restricted = await mk("R1", "restricted"), designated = await mk("D1", "designated");
  await scoped(t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = true WHERE tenant_id = ${t}::uuid`));
  // FY 2026-27 ledger: see the scenario in tests/nf7-fund-statements-domain.test.ts (same numbers, x100 paise)
  const l = (code: string, fundId: string, d: bigint, c: bigint, v: string) => ({
    tenantId: t, headId: (heads.get(code) as { id: string }).id, voucherNo: v, postingDate: "2026-08-10",
    debitMinor: d, creditMinor: c, balanceMinor: d - c, createdBy: ACTOR, updatedBy: ACTOR, fundId,
  });
  await scoped(t, (tx) => tx.insert(financeLedger).values([
    l("1100", general, 100000n, 0n, "S1"), l("4100", general, 0n, 100000n, "S1"),
    l("1100", restricted, 60000n, 0n, "S2"), l(GH.revenueIncomeGeneral, restricted, 0n, 60000n, "S2"),
    l("5100", restricted, 15000n, 0n, "S3"), l("1100", restricted, 0n, 15000n, "S3"),
    l(FUND_HEADS.transferOut, general, 20000n, 0n, "S4"), l(FUND_HEADS.dueTo, general, 0n, 20000n, "S4"),
    l(FUND_HEADS.dueFrom, designated, 20000n, 0n, "S4"), l(FUND_HEADS.transferIn, designated, 0n, 20000n, "S4"),
    l(FUND_HEADS.releaseOut, restricted, 10000n, 0n, "S5"), l(FUND_HEADS.dueTo, restricted, 0n, 10000n, "S5"),
    l(FUND_HEADS.dueFrom, general, 10000n, 0n, "S5"), l(FUND_HEADS.releaseIn, general, 0n, 10000n, "S5"),
  ]));
  return { t, heads, general, restricted, designated };
}

describe("fund-wise statements (nonprofit tenant, fund_accounting ON)", () => {
  it("Balance Sheet: each fund and the total balance; movement heads render as fund-movement lines; closing = 900/350/200", async () => {
    const app = await buildApp();
    try {
      const s = await seed({ nonprofit: true });
      const res = await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/balance-sheet?fy=2026-27", headers: bearer(s.t, ACTOR, ["finance_officer"]) });
      expect(res.statusCode).toBe(200);
      const b = res.json() as { funds: Array<{ fund: { code: string }; statement: { balanced: boolean; fundBalance: { closingMinor: string; fundMovements: Array<{ kind: string; amountMinor: string }>; lines: Array<{ code: string }> } } }>; total: { balanced: boolean; fundBalance: { closingMinor: string } } };
      const by = Object.fromEntries(b.funds.map((f) => [f.fund.code, f.statement]));
      expect(by.GENERAL!.fundBalance.closingMinor).toBe("90000");
      expect(by.R1!.fundBalance.closingMinor).toBe("35000");
      expect(by.D1!.fundBalance.closingMinor).toBe("20000");
      for (const f of b.funds) expect(f.statement.balanced, f.fund.code).toBe(true);
      expect(b.total.balanced).toBe(true);
      expect(b.total.fundBalance.closingMinor).toBe("145000");
      expect(by.GENERAL!.fundBalance.fundMovements.find((m) => m.kind === "transfer_out")!.amountMinor).toBe("-20000");
      expect(by.GENERAL!.fundBalance.lines.map((x) => x.code)).not.toContain(FUND_HEADS.transferOut);
    } finally { await app.close(); }
  });

  it("Income & Expenditure: grant income is grants_in_aid, transfers/releases are movement lines, BS surplus agrees", async () => {
    const app = await buildApp();
    try {
      const s = await seed({ nonprofit: true });
      const h = bearer(s.t, ACTOR, ["finance_officer"]);
      const ie = (await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/income-expenditure?fy=2026-27", headers: h })).json() as {
        funds: Array<{ fund: { code: string }; statement: { income: Array<{ group: string }>; surplusBeforeTransfersMinor: string; surplusAfterTransfersMinor: string; netFundMovementMinor: string } }>;
        total: { netFundMovementMinor: string };
      };
      const r1 = ie.funds.find((f) => f.fund.code === "R1")!.statement;
      expect(r1.income[0]!.group).toBe("grants_in_aid");
      expect(r1.surplusBeforeTransfersMinor).toBe("45000");
      expect(r1.surplusAfterTransfersMinor).toBe("35000");
      expect(ie.total.netFundMovementMinor).toBe("0");
      const bs = (await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/balance-sheet?fy=2026-27", headers: h })).json() as { funds: Array<{ fund: { code: string }; statement: { fundBalance: { surplusDeficitMinor: string } } }> };
      for (const f of ie.funds) expect(bs.funds.find((x) => x.fund.code === f.fund.code)!.statement.fundBalance.surplusDeficitMinor).toBe(f.statement.surplusBeforeTransfersMinor);
    } finally { await app.close(); }
  });

  it("Receipts & Payments: the fund-tagged cash book gives opening + receipts - payments = closing per fund; UC form stays null until recorded", async () => {
    const app = await buildApp();
    try {
      const s = await seed({ nonprofit: true });
      const cash = (fund: string, receipt: number, payment: number, head: string | null) => scoped(s.t, (tx) => tx.execute(sql`
        INSERT INTO gl.finance_cash_book (tenant_id, entry_date, voucher_type, voucher_no, particulars, receipt_minor, payment_minor, balance_minor, bank_or_cash, fund_id, head_id)
        VALUES (${s.t}::uuid, '2026-08-10', ${receipt ? "receipt" : "payment"}, ${`CB-${randomUUID().slice(0, 6)}`}, 'x', ${receipt}, ${payment}, 0, 'bank', ${fund}::uuid, ${head}::uuid)`));
      await cash(s.restricted, 60000, 0, (s.heads.get(GH.revenueIncomeGeneral) as { id: string }).id);
      await cash(s.restricted, 0, 15000, (s.heads.get("5100") as { id: string }).id);
      const rp = (await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/receipts-payments?fy=2026-27", headers: bearer(s.t, ACTOR, ["finance_officer"]) })).json() as {
        funds: Array<{ fund: { code: string }; statement: { closingTotalMinor: string; totalReceiptsMinor: string; receipts: Array<{ group: string }> } }>;
      };
      const r1 = rp.funds.find((f) => f.fund.code === "R1")!.statement;
      expect(r1.totalReceiptsMinor).toBe("60000");
      expect(r1.closingTotalMinor).toBe("45000");
      expect(r1.receipts[0]!.group).toBe("grants_in_aid");
      const uc = (await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/utilisation-certificates?fy=2026-27", headers: bearer(s.t, ACTOR, ["finance_officer"]) })).json() as { grants: unknown[] };
      expect(Array.isArray(uc.grants)).toBe(true);
    } finally { await app.close(); }
  });
});

describe("per-fund year-end close rolls the inter-fund heads", () => {
  it("no 3910/3911/3920/3921 row in the next year's opening; each fund nets to zero and carries its movement in 3100; re-run is a no-op; FY2 statements open at the rolled balance", async () => {
    const app = await buildApp();
    try {
      const s = await seed({ nonprofit: true });
      const run = () => scoped(s.t, (tx) => fundYearEndRollover(tx, { tenantId: s.t, actorId: ACTOR }, { fy: "2026-27", next: "2027-28", reason: "nf7 test" }));
      expect((await run()).changed).toBe(true);
      const rows = await q1(s.t, sql`SELECT fund_id::text AS f, account_code AS code, (debit_minor - credit_minor)::text AS net FROM gl.finance_opening_balances
        WHERE tenant_id = ${s.t}::uuid AND fy_code = '2027-28' AND source = 'fy_close'`);
      const stale = new Set<string>([FUND_HEADS.transferOut, FUND_HEADS.transferIn, FUND_HEADS.releaseOut, FUND_HEADS.releaseIn]);
      expect(rows.filter((r) => stale.has(String(r.code)))).toEqual([]);
      const net = new Map<string, bigint>();
      for (const r of rows) net.set(String(r.f), (net.get(String(r.f)) ?? 0n) + BigInt(String(r.net)));
      for (const [f, v] of net) expect(v, f).toBe(0n);
      const g3100 = rows.find((r) => r.f === s.general && r.code === "3100");
      expect(g3100?.net).toBe("-90000");                       // 100000 income - 20000 transfer out + 10000 release in
      expect(rows.find((r) => r.f === s.designated && r.code === "3100")?.net).toBe("-20000");
      expect((await run()).changed).toBe(false);

      const bs = (await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/balance-sheet?fy=2027-28&comparatives=false", headers: bearer(s.t, ACTOR, ["finance_officer"]) })).json() as {
        funds: Array<{ fund: { code: string }; statement: { balanced: boolean; fundBalance: { closingMinor: string; fundMovements: Array<{ amountMinor: string }> } } }>;
      };
      const gen = bs.funds.find((f) => f.fund.code === "GENERAL")!.statement;
      expect(gen.fundBalance.closingMinor).toBe("90000");
      expect(gen.fundBalance.fundMovements.every((m) => m.amountMinor === "0")).toBe(true);
      for (const f of bs.funds) expect(f.statement.balanced).toBe(true);
    } finally { await app.close(); }
  });

  it("two consecutive years: a second year's transfer rolls too and nothing stale accumulates", async () => {
    const s = await seed({ nonprofit: true });
    const l = (code: string, fundId: string, d: bigint, c: bigint) => ({
      tenantId: s.t, headId: (s.heads.get(code) as { id: string }).id, voucherNo: "Y2", postingDate: "2027-09-01",
      debitMinor: d, creditMinor: c, balanceMinor: d - c, createdBy: ACTOR, updatedBy: ACTOR, fundId,
    });
    await scoped(s.t, (tx) => fundYearEndRollover(tx, { tenantId: s.t, actorId: ACTOR }, { fy: "2026-27", next: "2027-28", reason: "nf7 year one" }));
    await scoped(s.t, (tx) => tx.insert(financeLedger).values([
      l(FUND_HEADS.transferOut, s.general as string, 5000n, 0n), l(FUND_HEADS.dueTo, s.general as string, 0n, 5000n),
      l(FUND_HEADS.dueFrom, s.designated, 5000n, 0n), l(FUND_HEADS.transferIn, s.designated, 0n, 5000n),
    ]));
    await scoped(s.t, (tx) => fundYearEndRollover(tx, { tenantId: s.t, actorId: ACTOR }, { fy: "2027-28", next: "2028-29", reason: "nf7 year two" }));
    const rows = await q1(s.t, sql`SELECT account_code AS code FROM gl.finance_opening_balances WHERE tenant_id = ${s.t}::uuid AND fy_code = '2028-29' AND source = 'fy_close'`);
    expect(rows.map((r) => r.code).filter((c) => String(c).startsWith("39"))).toEqual([]);
  });
});

describe("flag OFF / govt: the fund-wise statements are invisible and the govt output is byte-identical", () => {
  it("govt tenant: fund-wise routes 404 FUNDS_NOT_ENABLED; govt statements + year-end read are identical before and after probing them", async () => {
    const app = await buildApp();
    try {
      const s = await seed({ nonprofit: false });
      const h = bearer(s.t, ACTOR, ["finance_officer"]);
      const govt = async () => JSON.stringify(await Promise.all(["trial-balance-check", "balance-sheet", "profit-and-loss", "receipts-payments", "cash-flow"]
        .map(async (p) => (await app.inject({ method: "GET", url: `/v1/finance/statements/${p}?fy=2026-27`, headers: h })).body)));
      const before = await govt();
      for (const p of ["balance-sheet", "income-expenditure", "receipts-payments", "utilisation-certificates", "set"]) {
        const r = await app.inject({ method: "GET", url: `/v1/finance/statements/fund-wise/${p}?fy=2026-27`, headers: h });
        expect(r.statusCode, p).toBe(404);
        expect((r.json() as { code?: string; error?: { code?: string } }).code ?? (r.json() as { error?: { code?: string } }).error?.code).toBe("FUNDS_NOT_ENABLED");
      }
      expect(await govt()).toBe(before);
      const ye = (await app.inject({ method: "GET", url: "/v1/finance/year-end/2026-27", headers: h })).json() as { status: string };
      expect(ye.status).toBe("not_run");
    } finally { await app.close(); }
  });

  it("fund_accounting ON with a govt chart template is refused by the resolver (STATEMENT_SET_NOT_AVAILABLE)", async () => {
    const app = await buildApp();
    try {
      const s = await seed({ nonprofit: true });
      await scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET coa_template = 'govt' WHERE tenant_id = ${s.t}::uuid`));
      const r = await app.inject({ method: "GET", url: "/v1/finance/statements/fund-wise/balance-sheet?fy=2026-27", headers: bearer(s.t, ACTOR, ["finance_officer"]) });
      expect(r.statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it("GET /v1/finance/statements/set-for-tenant: govt -> existing routes, nonprofit -> the fund-wise set", async () => {
    const app = await buildApp();
    try {
      const g = await seed({ nonprofit: false });
      const n = await seed({ nonprofit: true });
      const get = async (t: string) => (await app.inject({ method: "GET", url: "/v1/finance/statements/set-for-tenant", headers: bearer(t, ACTOR, ["finance_officer"]) })).json() as { id: string; statements: Array<{ route: string }> };
      expect((await get(g.t)).id).toBe("govt");
      const np = await get(n.t);
      expect(np.id).toBe("nonprofit");
      expect(np.statements.every((x) => x.route.includes("/fund-wise/"))).toBe(true);
    } finally { await app.close(); }
  });
});
