/**
 * Section 8 NF-7: data loaders for the fund-wise statutory statements (fund-statements.ts renders them).
 *
 * Read-only, tenant-scoped (RLS + explicit tenant_id filters), run in the caller's transaction. Reuses -- never reimplements --
 * the NF-1 per-fund readers: `fundOpeningForFy` (per-fund opening, already year-end rolled) and `fundLedgerMovements` (per-fund
 * FY movements, NULL fund_id = GENERAL through `coalesceFundSql`). Nothing here writes, and nothing here is reached unless the
 * route layer has seen fund_accounting ON.
 */
import { sql } from "drizzle-orm";
import { fyBounds } from "../../shared/ist-date.js";
import { coalesceFundSql, generalFundIdTx } from "../gl/funds.js";
import { FUND_HEAD_CODES, GRANT_HEAD_CODES, ACCUMULATED_FUND } from "../gl/system-heads.js";
import { DomainError } from "../masters/domain.js";
import { headDirectory, type Tx } from "../year-end/repo.js";
import { fundOpeningForFy, fundLedgerMovements } from "../year-end/fund-repo.js";
import type { CashRow, FundInfo, FundType, GrantUtilisationFacts, HeadLite, InterestTreatment, StatementCodes, StatementInput } from "./fund-statements.js";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];
const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));

/** The head codes the statements treat specially, from the ONE shared definitions (system-heads.ts), read at call time. */
export function statementCodes(): StatementCodes {
  const f = FUND_HEAD_CODES();
  const g = GRANT_HEAD_CODES();
  return {
    accumulatedFund: ACCUMULATED_FUND,
    movement: { transferOut: f.transferOut, transferIn: f.transferIn, releaseOut: f.releaseOut, releaseIn: f.releaseIn },
    grantLiability: new Set([g.revenueReceiptSalary, g.revenueReceiptGeneral, g.capitalReceipt, g.capitalDeferred]),
    grantIncome: new Set([g.revenueIncomeSalary, g.revenueIncomeGeneral, g.capitalRelease]),
    grantFund: new Set([g.capitalFund]),
  };
}

export async function loadFunds(tx: Tx, tenantId: string): Promise<FundInfo[]> {
  const rows = rowsOf(await tx.execute(sql`
    SELECT id::text AS id, code, name, type, fcra FROM gl.funds WHERE tenant_id = ${tenantId}::uuid ORDER BY code
  `));
  return rows.map((r) => ({ id: String(r.id), code: String(r.code), name: String(r.name), type: String(r.type) as FundType, fcra: r.fcra === true }));
}

/** The GENERAL fund id, or a refusal: the statements are fund-wise and need the fund master (fail-closed, like posting). */
export async function requireGeneralFund(tx: Tx, tenantId: string): Promise<string> {
  const general = await generalFundIdTx(tx, tenantId);
  if (!general) throw new DomainError("FUND_ACCOUNTING_NOT_READY", "fund accounting is on but the GENERAL fund does not exist");
  return general;
}

/** Everything the Balance Sheet and the Income & Expenditure account of one FY need. */
export async function loadStatementInput(tx: Tx, tenantId: string, fy: string): Promise<StatementInput> {
  const general = await requireGeneralFund(tx, tenantId);
  const dir = await headDirectory(tx, tenantId);
  const { start, end } = fyBounds(fy);
  const [funds, opening, movements] = await Promise.all([
    loadFunds(tx, tenantId),
    fundOpeningForFy(tx, tenantId, general, fy, dir),
    fundLedgerMovements(tx, tenantId, general, start, end),
  ]);
  const classes = new Map(rowsOf(await tx.execute(sql`
    SELECT code, statement_class FROM budget.finance_heads WHERE tenant_id = ${tenantId}::uuid AND statement_class IS NOT NULL
  `)).map((x) => [String(x.code), String(x.statement_class)]));
  const heads = new Map<string, HeadLite>([...dir].map(([code, h]) => [code, { name: h.name, classification: h.classification, statementClass: classes.get(code) ?? null }]));
  return { fy, funds, opening, movements, heads, codes: statementCodes() };
}

/** Cash-book aggregates of one FY by fund x bank-or-cash x tagged head (NULL fund_id = GENERAL; an untagged head stays null). */
export async function loadCashRows(tx: Tx, tenantId: string, fy: string): Promise<CashRow[]> {
  const general = await requireGeneralFund(tx, tenantId);
  const { start, end } = fyBounds(fy);
  const fund = coalesceFundSql("cb.fund_id", general);
  const rows = rowsOf(await tx.execute(sql`
    SELECT ${fund}::text AS fund_id, cb.bank_or_cash, fh.code AS head_code, MAX(fh.name) AS head_name,
           (COALESCE(SUM(cb.receipt_minor) FILTER (WHERE cb.entry_date < ${start}::date), 0)
            - COALESCE(SUM(cb.payment_minor) FILTER (WHERE cb.entry_date < ${start}::date), 0))::text AS opening,
           COALESCE(SUM(cb.receipt_minor) FILTER (WHERE cb.entry_date >= ${start}::date), 0)::text AS receipts,
           COALESCE(SUM(cb.payment_minor) FILTER (WHERE cb.entry_date >= ${start}::date), 0)::text AS payments
      FROM gl.finance_cash_book cb
      LEFT JOIN budget.finance_heads fh ON fh.id = cb.head_id AND fh.tenant_id = cb.tenant_id
     WHERE cb.tenant_id = ${tenantId}::uuid AND cb.entry_date <= ${end}::date
     GROUP BY 1, 2, 3
  `));
  return rows.map((r) => ({
    fundId: String(r.fund_id), bankOrCash: String(r.bank_or_cash), headCode: (r.head_code as string | null) ?? null, headName: (r.head_name as string | null) ?? null,
    openingMinor: big(r.opening), receiptMinor: big(r.receipts), paymentMinor: big(r.payments),
  }));
}

const toTreatment = (v: unknown): InterestTreatment | null => (v === "remit" || v === "adjust" || v === "retain" ? v : null);

/** Grant sanction / receipt / utilisation facts of one FY for the UC schedule. The UC form and interest treatment stay nullable. */
export async function loadUcFacts(tx: Tx, tenantId: string, fy: string): Promise<GrantUtilisationFacts[]> {
  const { start, end } = fyBounds(fy);
  const p0 = start.slice(0, 7), p1 = end.slice(0, 7);
  const rows = rowsOf(await tx.execute(sql`
    SELECT g.id::text AS id, g.fund_id::text AS fund_id, g.grantor, g.sanction_ref, g.category, g.amount_sanctioned_minor::text AS sanctioned,
      COALESCE((SELECT SUM(p.amount_minor) FROM gl.grant_postings p
                 WHERE p.tenant_id = g.tenant_id AND p.grant_id = g.id AND p.kind = 'receipt'
                   AND NOT EXISTS (SELECT 1 FROM gl.grant_posting_voids v WHERE v.tenant_id = p.tenant_id AND v.journal_id = p.journal_id)
                   AND p.posting_date >= ${start}::date AND p.posting_date <= ${end}::date), 0)::text AS received,
      COALESCE((SELECT SUM(u.amount_utilised_minor) FROM gl.grant_utilisation u
                 WHERE u.tenant_id = g.tenant_id AND u.grant_id = g.id AND u.period >= ${p0} AND u.period <= ${p1}), 0)::text AS utilised,
      COALESCE((SELECT u.unspent_balance_minor FROM gl.grant_utilisation u
                 WHERE u.tenant_id = g.tenant_id AND u.grant_id = g.id AND u.period <= ${p1} ORDER BY u.period DESC LIMIT 1), 0)::text AS unspent,
      COALESCE((SELECT SUM(u.interest_earned_minor) FROM gl.grant_utilisation u
                 WHERE u.tenant_id = g.tenant_id AND u.grant_id = g.id AND u.period >= ${p0} AND u.period <= ${p1}), 0)::text AS interest,
      (SELECT u.uc_form FROM gl.grant_utilisation u WHERE u.tenant_id = g.tenant_id AND u.grant_id = g.id
          AND u.period >= ${p0} AND u.period <= ${p1} AND u.uc_form IS NOT NULL ORDER BY u.period DESC LIMIT 1) AS uc_form,
      (SELECT u.interest_treatment FROM gl.grant_utilisation u WHERE u.tenant_id = g.tenant_id AND u.grant_id = g.id
          AND u.period >= ${p0} AND u.period <= ${p1} AND u.interest_treatment IS NOT NULL ORDER BY u.period DESC LIMIT 1) AS treatment,
      (SELECT MAX(u.uc_submitted_date)::text FROM gl.grant_utilisation u WHERE u.tenant_id = g.tenant_id AND u.grant_id = g.id
          AND u.period >= ${p0} AND u.period <= ${p1}) AS uc_submitted
      FROM gl.grants g
     WHERE g.tenant_id = ${tenantId}::uuid AND g.sanction_date <= ${end}::date
     ORDER BY g.sanction_date, g.id
  `));
  return rows.map((r) => ({
    grantId: String(r.id), fundId: String(r.fund_id), grantor: String(r.grantor), sanctionRef: String(r.sanction_ref), category: String(r.category),
    sanctionedMinor: big(r.sanctioned), receivedMinor: big(r.received), utilisedMinor: big(r.utilised), unspentMinor: big(r.unspent), interestEarnedMinor: big(r.interest),
    ucForm: (r.uc_form as string | null) ?? null, interestTreatment: toTreatment(r.treatment), ucSubmittedDate: (r.uc_submitted as string | null) ?? null,
  }));
}

/** The tenant's stored chart template (gl.finance_settings.coa_template); null when no settings row (=> govt in the resolver). */
export async function loadCoaTemplate(tx: Tx, tenantId: string): Promise<string | null> {
  const [row] = rowsOf(await tx.execute(sql`SELECT coa_template FROM gl.finance_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`));
  return (row?.coa_template as string | null) ?? null;
}
