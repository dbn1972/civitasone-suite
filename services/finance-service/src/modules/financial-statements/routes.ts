import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { currentFyIST } from "../../shared/ist-date.js";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { headNatureOf, type HeadNature } from "../../shared/head-nature.js";
import { fyBalances, type FyBalanceRow } from "../year-end/repo.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

// UAT T-PERIOD D-06: the default financial year is the one containing TODAY IN IST (not the UTC / server-local date).
function deriveFYFromDate(d = new Date()): string {
  return currentFyIST(d);
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
export function natureOf(code: string, classification: string | null): HeadNature {
  // UAT P2 (A5): one shared rule (shared/head-nature.ts) so the statement list and the dashboard agree with this.
  return headNatureOf(code, classification);
}

export async function financialStatementsRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/statements/trial-balance-check -- proves the GL balances, FOR ONE FINANCIAL YEAR.
  // UAT T-PERIOD D-05 (ERP-head decision): statements are bounded by the financial year, not cumulative from inception.
  // Each head = its opening balance (carry-forward heads and the accumulated fund only -- revenue and expenditure heads
  // start the year at zero) + this year debits and credits. The 2026-27 income / expenditure balances no longer roll
  // into the 2027-28 trial balance; their net sits on the fund.
  app.get("/v1/finance/statements/trial-balance-check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { start, end } = fyBounds(fy);
    const { opening, rows } = await scopedRead((tx) => fyBalances(tx, ctx.tenantId, fy));
    const lines = rows.filter((r) => r.openingMinor !== 0n || r.debitMinor !== 0n || r.creditMinor !== 0n).map((r) => {
      const openDr = r.openingMinor > 0n ? r.openingMinor : 0n;
      const openCr = r.openingMinor < 0n ? -r.openingMinor : 0n;
      return {
        code: r.code, name: r.name, classification: r.classification, nature: r.nature, carryForward: r.carryForward,
        // debit / credit columns = opening (on its side) + this year movements, so the columns total the same
        debitMinor: (openDr + r.debitMinor).toString(), creditMinor: (openCr + r.creditMinor).toString(),
        openingMinor: r.openingMinor.toString(), periodDebitMinor: r.debitMinor.toString(),
        periodCreditMinor: r.creditMinor.toString(), closingMinor: r.closingMinor.toString(),
      };
    });
    const totalDr = lines.reduce((acc, l) => acc + BigInt(l.debitMinor), 0n);
    const totalCr = lines.reduce((acc, l) => acc + BigInt(l.creditMinor), 0n);
    return reply.send({
      fiscalYear: fy, periodStart: start, asOf: end, openingSource: opening.source,
      totalDebitMinor: totalDr.toString(),
      totalCreditMinor: totalCr.toString(),
      differenceMinor: (totalDr - totalCr).toString(),
      isBalanced: totalDr === totalCr,
      lines,
    });
  });

  // GET /v1/finance/statements/balance-sheet -- GL-derived Balance Sheet at 31 March of the financial year.
  // UAT T-PERIOD D-05: balance-sheet heads = opening (carried from the previous year) + this year movements; the
  // surplus / deficit is THIS year income - expenditure only, and the earlier years surplus is the accumulated fund.
  app.get("/v1/finance/statements/balance-sheet", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();
    const { end } = fyBounds(fy);
    const { opening, rows } = await scopedRead((tx) => fyBalances(tx, ctx.tenantId, fy));

    const assets: any[] = [], liabilities: any[] = [], equity: any[] = [];
    let totalAssets = 0n, totalLiabilities = 0n, totalEquity = 0n;
    let income = 0n, expense = 0n;

    for (const r of rows) {
      const closing = r.closingMinor; // debit-positive
      // #2464 review: a carry-forward head of income / expense nature (a 5xxx head classified advance / deposit /
      // suspense, an 8xxx head classified expense) carries an opening balance, so it is a balance-sheet item by its
      // closing balance: a debit balance is an asset, a credit balance a liability.
      if (r.carryForward && (r.nature === "income" || r.nature === "expense")) {
        if (closing > 0n) { assets.push(fyLine({ ...r, nature: "asset" }, closing)); totalAssets += closing; }
        else if (closing < 0n) { liabilities.push(fyLine({ ...r, nature: "liability" }, -closing)); totalLiabilities += -closing; }
        continue;
      }
      if (r.nature === "asset") {
        if (closing !== 0n) assets.push(fyLine(r, closing));
        totalAssets += closing;
      } else if (r.nature === "liability") {
        if (closing !== 0n) liabilities.push(fyLine(r, -closing));
        totalLiabilities += -closing;
      } else if (r.nature === "equity") {
        if (closing !== 0n) equity.push(fyLine(r, -closing));
        totalEquity += -closing;
      } else if (r.nature === "income") {
        income += r.creditMinor - r.debitMinor;
      } else {
        expense += r.debitMinor - r.creditMinor;
      }
    }

    // This year net surplus/deficit rolls into accumulated funds (equity).
    const surplusMinor = income - expense;
    const equityWithSurplus = totalEquity + surplusMinor;
    const totalLiabAndEquity = totalLiabilities + equityWithSurplus;
    const balanced = totalAssets === totalLiabAndEquity;

    return reply.send({
      fiscalYear: fy, asOf: end, openingSource: opening.source,
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
        equation: "assets = liabilities + equity (incl. fund brought forward) + (this year income - expense)",
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
    // Opening balance = net of every entry before the FY start (carried forward from prior years);
    // closing = opening + FY receipts - FY payments. Rows are also returned for a cash/bank with only prior entries.
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT bank_or_cash,
             (COALESCE(SUM(receipt_minor) FILTER (WHERE entry_date < ${start}::date), 0)
              - COALESCE(SUM(payment_minor) FILTER (WHERE entry_date < ${start}::date), 0))::bigint AS opening_balance,
             COALESCE(SUM(receipt_minor) FILTER (WHERE entry_date >= ${start}::date), 0)::bigint AS total_receipts,
             COALESCE(SUM(payment_minor) FILTER (WHERE entry_date >= ${start}::date), 0)::bigint AS total_payments,
             (COALESCE(SUM(receipt_minor), 0) - COALESCE(SUM(payment_minor), 0))::bigint AS closing_balance
      FROM gl.finance_cash_book
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND entry_date <= ${end}::date
      GROUP BY bank_or_cash
      ORDER BY bank_or_cash
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
      ORDER BY (EXTRACT(MONTH FROM entry_date)::int + 8) % 12
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

function fyLine(r: FyBalanceRow, balanceMinor: bigint) {
  return {
    code: r.code, name: r.name, classification: r.classification,
    openingMinor: (r.nature === "asset" ? r.openingMinor : -r.openingMinor).toString(),
    balanceMinor: balanceMinor.toString(),
  };
}
