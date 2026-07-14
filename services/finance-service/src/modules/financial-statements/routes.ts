import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

function deriveFYFromDate(d = new Date()): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

function fyBounds(fy: string): { start: string; end: string } {
  const startYear = Number(fy.slice(0, 4));
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

type TbRow = {
  code: string; name: string; classification: string | null;
  dr: string | number | null; cr: string | number | null;
};

function bi(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  return BigInt(v);
}

/**
 * Normal-balance nature derived from the chart-of-accounts code prefix, with the
 * classification as a tie-breaker. The seeded COA mixes 'capital' (1200/1250 are
 * really assets) and 'revenue' (used for income), so a pure classification map
 * mis-states the balance sheet. The leading code digit is the authoritative COA
 * convention here: 1=asset, 2/3=liability or equity, 4=income, 5/6=expense.
 *   asset/expense  -> debit-normal  (balance = dr - cr)
 *   liability/equity/income -> credit-normal (balance = cr - dr)
 */
function natureOf(code: string, classification: string | null): "asset" | "liability" | "equity" | "income" | "expense" {
  const d = code.charAt(0);
  if (d === "1") return "asset";
  if (d === "4" && (classification === "income" || classification === "revenue")) return "income";
  if (d === "5" || d === "6") return "expense";
  if (code === "4200") return "expense"; // gain/loss on disposal
  if (d === "4") return "income";
  if (d === "3" && classification === "equity") return "equity";
  if (d === "2" || d === "3") return "liability";
  // fall back to the stored classification
  if (classification === "asset") return "asset";
  if (classification === "equity") return "equity";
  if (classification === "income" || classification === "revenue") return "income";
  if (classification === "expense" || classification === "expenditure") return "expense";
  return "liability";
}

async function loadTrialBalance(tenantId: string, end: string): Promise<TbRow[]> {
  return (await scopedRead((tx) => tx.execute(sql`
    SELECT fh.code, fh.name, fh.classification,
           COALESCE(SUM(fl.debit_minor), 0)::bigint  AS dr,
           COALESCE(SUM(fl.credit_minor), 0)::bigint AS cr
    FROM budget.finance_heads fh
    LEFT JOIN gl.finance_ledger fl
      ON fl.head_id = fh.id AND fl.tenant_id = fh.tenant_id
     AND fl.posting_date <= ${end}::date
    WHERE fh.tenant_id = ${tenantId}::uuid
    GROUP BY fh.code, fh.name, fh.classification
    HAVING COALESCE(SUM(fl.debit_minor), 0) <> 0 OR COALESCE(SUM(fl.credit_minor), 0) <> 0
    ORDER BY fh.code
  `))) as unknown as TbRow[];
}

export async function financialStatementsRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/statements/trial-balance-check — proves the GL balances.
  app.get("/v1/finance/statements/trial-balance-check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { end } = fyBounds(fy);
    const rows = await loadTrialBalance(ctx.tenantId, end);
    const totalDr = rows.reduce((s, r) => s + bi(r.dr), 0n);
    const totalCr = rows.reduce((s, r) => s + bi(r.cr), 0n);
    return reply.send({
      fiscalYear: fy, asOf: end,
      totalDebitMinor: totalDr.toString(),
      totalCreditMinor: totalCr.toString(),
      differenceMinor: (totalDr - totalCr).toString(),
      isBalanced: totalDr === totalCr,
      lines: rows.map((r) => ({
        code: r.code, name: r.name, classification: r.classification,
        nature: natureOf(r.code, r.classification),
        debitMinor: bi(r.dr).toString(), creditMinor: bi(r.cr).toString(),
      })),
    });
  });

  // GET /v1/finance/statements/balance-sheet — GL-derived Balance Sheet.
  app.get("/v1/finance/statements/balance-sheet", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { end } = fyBounds(fy);
    const rows = await loadTrialBalance(ctx.tenantId, end);

    const assets: any[] = [], liabilities: any[] = [], equity: any[] = [];
    let totalAssets = 0n, totalLiabilities = 0n, totalEquity = 0n;
    let income = 0n, expense = 0n;

    for (const r of rows) {
      const nature = natureOf(r.code, r.classification);
      const dr = bi(r.dr), cr = bi(r.cr);
      if (nature === "asset") {
        const bal = dr - cr;
        assets.push(line(r, bal)); totalAssets += bal;
      } else if (nature === "liability") {
        const bal = cr - dr;
        liabilities.push(line(r, bal)); totalLiabilities += bal;
      } else if (nature === "equity") {
        const bal = cr - dr;
        equity.push(line(r, bal)); totalEquity += bal;
      } else if (nature === "income") {
        income += (cr - dr);
      } else {
        expense += (dr - cr);
      }
    }

    // Net surplus/deficit for the period rolls into accumulated funds (equity).
    const surplusMinor = income - expense;
    const equityWithSurplus = totalEquity + surplusMinor;
    const totalLiabAndEquity = totalLiabilities + equityWithSurplus;
    const balanced = totalAssets === totalLiabAndEquity;

    return reply.send({
      fiscalYear: fy, asOf: end,
      assets, liabilities, equity,
      surplusDeficitMinor: surplusMinor.toString(),
      totals: {
        totalAssetsMinor: totalAssets.toString(),
        totalLiabilitiesMinor: totalLiabilities.toString(),
        totalEquityMinor: totalEquity.toString(),
        accumulatedFundsMinor: equityWithSurplus.toString(),
        totalLiabilitiesAndEquityMinor: totalLiabAndEquity.toString(),
      },
      balanceCheck: {
        balanced,
        differenceMinor: (totalAssets - totalLiabAndEquity).toString(),
        equation: "assets = liabilities + equity + (income - expense)",
      },
    });
  });

  // GET /v1/finance/statements/profit-and-loss — Income & Expenditure (P&L).
  const plHandler = async (req: any, reply: any) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { start, end } = fyBounds(fy);

    // P&L is a flow statement — only this FY's movements.
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT fh.code, fh.name, fh.classification,
             COALESCE(SUM(fl.debit_minor), 0)::bigint  AS dr,
             COALESCE(SUM(fl.credit_minor), 0)::bigint AS cr
      FROM budget.finance_heads fh
      LEFT JOIN gl.finance_ledger fl
        ON fl.head_id = fh.id AND fl.tenant_id = fh.tenant_id
       AND fl.posting_date >= ${start}::date AND fl.posting_date <= ${end}::date
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      GROUP BY fh.code, fh.name, fh.classification
      HAVING COALESCE(SUM(fl.debit_minor), 0) <> 0 OR COALESCE(SUM(fl.credit_minor), 0) <> 0
      ORDER BY fh.code
    `))) as unknown as TbRow[];

    const income: any[] = [], expenditure: any[] = [];
    let totalIncome = 0n, totalExpenditure = 0n;
    for (const r of rows) {
      const nature = natureOf(r.code, r.classification);
      const dr = bi(r.dr), cr = bi(r.cr);
      if (nature === "income") {
        const bal = cr - dr;
        income.push(line(r, bal)); totalIncome += bal;
      } else if (nature === "expense") {
        const bal = dr - cr;
        expenditure.push(line(r, bal)); totalExpenditure += bal;
      }
    }
    return reply.send({
      fiscalYear: fy, periodStart: start, periodEnd: end,
      income, expenditure,
      totalIncomeMinor: totalIncome.toString(),
      totalExpenditureMinor: totalExpenditure.toString(),
      surplusDeficitMinor: (totalIncome - totalExpenditure).toString(),
      result: totalIncome >= totalExpenditure ? "surplus" : "deficit",
    });
  };
  app.get("/v1/finance/statements/profit-and-loss", plHandler);
  // Backwards-compatible alias for the previous income-expenditure path.
  app.get("/v1/finance/statements/income-expenditure", plHandler);

  // GET /v1/finance/statements/receipts-payments — Receipts & Payments Account.
  app.get("/v1/finance/statements/receipts-payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { start, end } = fyBounds(fy);
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT bank_or_cash,
             COALESCE(SUM(receipt_minor), 0)::bigint AS total_receipts,
             COALESCE(SUM(payment_minor), 0)::bigint AS total_payments,
             (COALESCE(SUM(receipt_minor), 0) - COALESCE(SUM(payment_minor), 0))::bigint AS closing_balance
      FROM gl.finance_cash_book
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND entry_date >= ${start}::date AND entry_date <= ${end}::date
      GROUP BY bank_or_cash
    `));
    return reply.send({ fiscalYear: fy, data: rows });
  });

  // GET /v1/finance/statements/cash-flow — monthly cash flow.
  app.get("/v1/finance/statements/cash-flow", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { start, end } = fyBounds(fy);
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT EXTRACT(MONTH FROM entry_date)::int AS month,
             COALESCE(SUM(receipt_minor), 0)::bigint AS inflows,
             COALESCE(SUM(payment_minor), 0)::bigint AS outflows,
             (COALESCE(SUM(receipt_minor), 0) - COALESCE(SUM(payment_minor), 0))::bigint AS net_flow
      FROM gl.finance_cash_book
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND entry_date >= ${start}::date AND entry_date <= ${end}::date
      GROUP BY EXTRACT(MONTH FROM entry_date)
      ORDER BY month
    `));
    return reply.send({ fiscalYear: fy, monthlyFlows: rows });
  });
}

function line(r: TbRow, balanceMinor: bigint) {
  return {
    code: r.code, name: r.name, classification: r.classification,
    balanceMinor: balanceMinor.toString(),
  };
}
