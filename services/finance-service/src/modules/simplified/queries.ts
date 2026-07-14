/**
 * Simplified module queries — read from GL journal lines, aggregated
 * into MSME-friendly shapes (no GL jargon exposed).
 *
 * All reads go through the existing finance_journal_lines denormalized table
 * and the simplified.transactions record, filtered by tenant.
 */
import { scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import { paiseToRupees } from "./auto-journal.js";

/**
 * Returns MSME-friendly financial summary for a given period (YYYY-MM).
 * Aggregates from GL journal lines using account code ranges:
 * - Income: 4xxx heads
 * - Expense: 5xxx heads
 * - Cash: 1001
 * - Receivables: 1002
 * - Payables: 2001
 * - GST liability: 2002
 */
export async function getSummary(tenantId: string, period?: string) {
  const targetPeriod = period ?? new Date().toISOString().slice(0, 7);
  const [year, month] = targetPeriod.split("-");
  const startDate = `${year}-${month}-01`;
  const endDate = getLastDayOfMonth(Number(year), Number(month));

  // Aggregate from GL journal lines for the period
  const result = await scopedRead((tx) => tx.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN head_code LIKE '4%' THEN credit_minor - debit_minor ELSE 0 END), 0)::bigint AS total_income,
      COALESCE(SUM(CASE WHEN head_code LIKE '5%' THEN debit_minor - credit_minor ELSE 0 END), 0)::bigint AS total_expense
    FROM gl.finance_journal_lines
    WHERE tenant_id = ${tenantId}::uuid
      AND posting_date >= ${startDate}::date
      AND posting_date <= ${endDate}::date
  `));

  // Balance queries (cumulative, not period-scoped)
  const balances = await scopedRead((tx) => tx.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN head_code = '1001' THEN debit_minor - credit_minor ELSE 0 END), 0)::bigint AS cash_balance,
      COALESCE(SUM(CASE WHEN head_code = '1002' THEN debit_minor - credit_minor ELSE 0 END), 0)::bigint AS receivables,
      COALESCE(SUM(CASE WHEN head_code = '2001' THEN credit_minor - debit_minor ELSE 0 END), 0)::bigint AS payables,
      COALESCE(SUM(CASE WHEN head_code = '2002' THEN credit_minor - debit_minor ELSE 0 END), 0)::bigint AS gst_liability
    FROM gl.finance_journal_lines
    WHERE tenant_id = ${tenantId}::uuid
  `));

  const row = result[0] as Record<string, string | null> | undefined;
  const bal = balances[0] as Record<string, string | null> | undefined;

  const totalIncome = BigInt(row?.total_income ?? "0");
  const totalExpense = BigInt(row?.total_expense ?? "0");
  const cashBalance = BigInt(bal?.cash_balance ?? "0");
  const receivables = BigInt(bal?.receivables ?? "0");
  const payables = BigInt(bal?.payables ?? "0");
  const gstLiability = BigInt(bal?.gst_liability ?? "0");

  return {
    period: targetPeriod,
    totalIncome: paiseToRupees(totalIncome),
    totalExpense: paiseToRupees(totalExpense),
    profit: paiseToRupees(totalIncome - totalExpense),
    cashBalance: paiseToRupees(cashBalance),
    receivables: paiseToRupees(receivables),
    payables: paiseToRupees(payables),
    gstLiability: paiseToRupees(gstLiability),
  };
}

/**
 * List income transactions — user-friendly format.
 */
export async function getIncomeList(tenantId: string, opts: { from?: string | undefined; to?: string | undefined; limit: number }) {
  const conditions = [sql`tenant_id = ${tenantId}::uuid`, sql`type IN ('sales_invoice')`];
  if (opts.from) conditions.push(sql`posting_date >= ${opts.from}::date`);
  if (opts.to) conditions.push(sql`posting_date <= ${opts.to}::date`);

  const where = sql.join(conditions, sql` AND `);

  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, posting_date, counter_party AS customer, amount_minor, gst_minor,
           total_minor, invoice_no, description, created_at
    FROM simplified.transactions
    WHERE ${where}
    ORDER BY posting_date DESC, created_at DESC
    LIMIT ${opts.limit}
  `));

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id,
    date: r.posting_date,
    customer: r.customer,
    amount: paiseToRupees(BigInt(String(r.amount_minor))),
    gst: paiseToRupees(BigInt(String(r.gst_minor))),
    total: paiseToRupees(BigInt(String(r.total_minor))),
    invoiceNo: r.invoice_no,
    description: r.description,
  }));
}

/**
 * List expense transactions — user-friendly format.
 */
export async function getExpenseList(tenantId: string, opts: { from?: string | undefined; to?: string | undefined; limit: number }) {
  const conditions = [sql`tenant_id = ${tenantId}::uuid`, sql`type IN ('expense_recorded', 'purchase', 'salary_paid')`];
  if (opts.from) conditions.push(sql`posting_date >= ${opts.from}::date`);
  if (opts.to) conditions.push(sql`posting_date <= ${opts.to}::date`);

  const where = sql.join(conditions, sql` AND `);

  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, posting_date, account_code AS category_code, counter_party AS vendor,
           amount_minor, gst_minor, total_minor, description, created_at
    FROM simplified.transactions
    WHERE ${where}
    ORDER BY posting_date DESC, created_at DESC
    LIMIT ${opts.limit}
  `));

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id,
    date: r.posting_date,
    category: r.category_code,
    vendor: r.vendor,
    amount: paiseToRupees(BigInt(String(r.amount_minor))),
    gst: paiseToRupees(BigInt(String(r.gst_minor))),
    total: paiseToRupees(BigInt(String(r.total_minor))),
    description: r.description,
  }));
}

/**
 * Cash flow — money in vs money out by week for the period.
 */
export async function getCashflow(tenantId: string, opts: { from?: string | undefined; to?: string | undefined }) {
  const from = opts.from ?? getFirstDayOfMonth();
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT
      date_trunc('week', posting_date::timestamp)::date AS week_start,
      COALESCE(SUM(CASE WHEN head_code = '1001' AND debit_minor > 0 THEN debit_minor ELSE 0 END), 0)::bigint AS money_in,
      COALESCE(SUM(CASE WHEN head_code = '1001' AND credit_minor > 0 THEN credit_minor ELSE 0 END), 0)::bigint AS money_out
    FROM gl.finance_journal_lines
    WHERE tenant_id = ${tenantId}::uuid
      AND posting_date >= ${from}::date
      AND posting_date <= ${to}::date
      AND head_code = '1001'
    GROUP BY week_start
    ORDER BY week_start
  `));

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    weekStart: r.week_start,
    moneyIn: paiseToRupees(BigInt(String(r.money_in))),
    moneyOut: paiseToRupees(BigInt(String(r.money_out))),
    net: paiseToRupees(BigInt(String(r.money_in)) - BigInt(String(r.money_out))),
  }));
}

// --- helpers ---

function getLastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0); // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10);
}

function getFirstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
