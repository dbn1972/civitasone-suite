import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

function deriveFYFromDate(d = new Date()): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

export async function financialStatementsRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/statements/balance-sheet — auto-generated Balance Sheet
  app.get("/v1/finance/statements/balance-sheet", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();

    // Use finance_heads as chart of accounts + finance_ledger for balances
    const rows = await db.execute(sql`
      SELECT fh.code, fh.name, fh.classification,
             COALESCE(SUM(fl.debit_minor), 0)::bigint AS total_debit,
             COALESCE(SUM(fl.credit_minor), 0)::bigint AS total_credit,
             (COALESCE(SUM(fl.debit_minor), 0) - COALESCE(SUM(fl.credit_minor), 0))::bigint AS net_balance
      FROM budget.finance_heads fh
      LEFT JOIN gl.finance_ledger fl ON fl.head_id = fh.id AND fl.tenant_id = fh.tenant_id
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      GROUP BY fh.code, fh.name, fh.classification
      ORDER BY fh.code
    `);

    const allRows = rows as unknown as any[];
    const assets = allRows.filter((r: any) => r.classification === "asset");
    const liabilities = allRows.filter((r: any) => r.classification === "liability");
    const equity = allRows.filter((r: any) => r.classification === "equity");
    const other = allRows.filter((r: any) => !["asset", "liability", "equity"].includes(r.classification));

    return reply.send({
      fiscalYear: fy,
      assets,
      liabilities,
      equity,
      other,
      totalAssets: assets.reduce((sum: number, r: any) => sum + Number(r.net_balance), 0),
      totalLiabilities: liabilities.reduce((sum: number, r: any) => sum + Math.abs(Number(r.net_balance)), 0),
      totalEquity: equity.reduce((sum: number, r: any) => sum + Math.abs(Number(r.net_balance)), 0),
    });
  });

  // GET /v1/finance/statements/income-expenditure — Income & Expenditure Account
  app.get("/v1/finance/statements/income-expenditure", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();

    // Use finance_heads + finance_ledger (head classification for income/expense)
    const rows = await db.execute(sql`
      SELECT fh.code, fh.name, fh.classification,
             COALESCE(SUM(fl.debit_minor), 0)::bigint AS total_debit,
             COALESCE(SUM(fl.credit_minor), 0)::bigint AS total_credit,
             (COALESCE(SUM(fl.credit_minor), 0) - COALESCE(SUM(fl.debit_minor), 0))::bigint AS net_amount
      FROM budget.finance_heads fh
      LEFT JOIN gl.finance_ledger fl ON fl.head_id = fh.id AND fl.tenant_id = fh.tenant_id
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
        AND fh.classification IN ('income', 'expense', 'revenue', 'expenditure')
      GROUP BY fh.code, fh.name, fh.classification
      ORDER BY fh.classification, fh.code
    `);

    const allRows = rows as unknown as any[];
    const income = allRows.filter((r: any) => r.classification === "income" || r.classification === "revenue");
    const expenditure = allRows.filter((r: any) => r.classification === "expense" || r.classification === "expenditure");
    const totalIncome = income.reduce((sum: number, r: any) => sum + Number(r.net_amount), 0);
    const totalExpenditure = expenditure.reduce((sum: number, r: any) => sum + Math.abs(Number(r.net_amount)), 0);

    return reply.send({
      fiscalYear: fy,
      income,
      expenditure,
      totalIncome,
      totalExpenditure,
      surplus: totalIncome - totalExpenditure,
    });
  });

  // GET /v1/finance/statements/receipts-payments — Receipts & Payments Account
  app.get("/v1/finance/statements/receipts-payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();

    const rows = await db.execute(sql`
      SELECT bank_or_cash,
             COALESCE(SUM(receipt_minor), 0)::bigint AS total_receipts,
             COALESCE(SUM(payment_minor), 0)::bigint AS total_payments,
             (COALESCE(SUM(receipt_minor), 0) - COALESCE(SUM(payment_minor), 0))::bigint AS closing_balance
      FROM gl.finance_cash_book
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND entry_date >= (CASE WHEN SUBSTRING(${fy} FROM 6 FOR 2)::int < 50
            THEN (SUBSTRING(${fy} FROM 1 FOR 4)::int || '-04-01')::date
            ELSE (SUBSTRING(${fy} FROM 1 FOR 4)::int || '-04-01')::date END)
      GROUP BY bank_or_cash
    `);

    return reply.send({ fiscalYear: fy, data: rows });
  });

  // GET /v1/finance/statements/cash-flow — Cash Flow Statement
  app.get("/v1/finance/statements/cash-flow", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    const fy = q.fy ?? deriveFYFromDate();

    const rows = await db.execute(sql`
      SELECT
        EXTRACT(MONTH FROM entry_date)::int AS month,
        COALESCE(SUM(receipt_minor), 0)::bigint AS inflows,
        COALESCE(SUM(payment_minor), 0)::bigint AS outflows,
        (COALESCE(SUM(receipt_minor), 0) - COALESCE(SUM(payment_minor), 0))::bigint AS net_flow
      FROM gl.finance_cash_book
      WHERE tenant_id = ${ctx.tenantId}::uuid
      GROUP BY EXTRACT(MONTH FROM entry_date)
      ORDER BY month
    `);

    return reply.send({ fiscalYear: fy, monthlyFlows: rows });
  });
}
