/**
 * F89/F91 (UAT T6-01, T6-03): the STANDARD GL heads -- every chart-of-accounts code that a finance-service posting path
 * resolves BY CODE when it builds a journal (depreciation, disposal, billing, revenue, refund, payroll, AP, TDS,
 * deposits). A tenant whose chart lacks one of these has every such posting refused (UNKNOWN_ACCOUNT_CODE /
 * INVALID_HEAD_CODE), so the set is seeded for a new tenant at provisioning (tenant-onboard/consumer.ts) and backfilled
 * for existing tenants by scripts/backfill-standard-gl-heads.ts. Only MISSING codes are ever added; a head the tenant
 * already has is never changed.
 *
 * Each code is read from the SAME environment variable, with the SAME default, as the posting path that uses it, so a
 * deployment that remaps a head (e.g. FINANCE_BILLING_RECEIVABLE_CODE) seeds the head it will actually post to.
 * tests/standard-gl-heads.test.ts scans the posting modules and fails if one of their default codes is missing here.
 *
 * Names and classifications follow the chart already seeded (scripts/dev/seed-all.mjs, migration 0015) and the
 * statements' convention (financial-statements/routes.ts natureOf): 1xxx asset ('capital' for the fixed-asset block),
 * 2xxx liability, 4xxx income (4200 gain/loss on disposal is an expense head), 5xxx/6xxx expense.
 */
import { financeHeads } from "../budget/schema.js";
import { DEP_EXPENSE, DEP_EXPENSE_STAT, ACCUM_DEP, FIXED_ASSET } from "./system-heads.js";

export type StandardGlHead = {
  code: string; name: string; classification: string;
  /** 18-digit PFMS Head of Account, for heads a bill is raised against (the bill consumer validates it, see hoa/domain.ts). */
  hoaCode?: string;
  /** A sub-ledger control account: manual journals may not post to it (GAP-FINANCE-JOURNAL-ENTRY-04). */
  isControl?: boolean;
};

/** The system actor stamped on seeded heads (created_by / updated_by). */
export const SEED_ACTOR = "00000000-0000-0000-0000-000000000000";

const env = (name: string, fallback: string): string => process.env[name] ?? fallback;
/** The `process.env.X?.trim() || "code"` form the bill producers use (an empty value falls back too). */
const envTrim = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;

/**
 * HoA for the default bill head 2202 (CGA major head 2202 General Education, present in budget.finance_major_heads):
 * major 2202 / sub-major 01 / minor 101 / sub-head 01 / detailed 01 / object 01 / reserved 000. Only the major head is
 * validated against a master; the lower segments are a placeholder the tenant's finance admin can refine.
 */
export const BILL_HEAD_HOA = "220201101010101000";

export function standardGlHeads(): StandardGlHead[] {
  const heads: StandardGlHead[] = [
    // assets
    { code: env("FINANCE_BANK_CODE", "1100"), name: "Cash / Bank", classification: "asset" },
    { code: env("FINANCE_CASH_CODE", "1100"), name: "Cash / Bank", classification: "asset" },
    { code: env("FINANCE_REVENUE_CASH_CODE", "1100"), name: "Cash / Bank", classification: "asset" },
    { code: env("FINANCE_BILLING_CASH_CODE", "1100"), name: "Cash / Bank", classification: "asset" },
    { code: env("PAYROLL_GL_BANK_HEAD", "1101"), name: "Bank - Salary Disbursement", classification: "asset" },
    { code: FIXED_ASSET, name: "Fixed Assets (Gross)", classification: "capital" },
    { code: ACCUM_DEP, name: "Accumulated Depreciation", classification: "capital" },
    { code: env("FINANCE_BILLING_RECEIVABLE_CODE", "1300"), name: "Accounts Receivable", classification: "asset" },
    { code: env("FINANCE_AR_CONTROL_CODE", "1300"), name: "Accounts Receivable", classification: "asset" },
    // liabilities
    { code: env("FINANCE_AP_CONTROL_CODE", "2050"), name: "Accounts Payable (Control)", classification: "liability", isControl: true },
    { code: env("FINANCE_DEPOSIT_LIABILITY_CODE", "2060"), name: "Deposits / Retention (Control)", classification: "liability" },
    { code: env("PAYROLL_GL_NET_PAYABLE_HEAD", "2101"), name: "Net Salary Payable", classification: "liability" },
    { code: "2102", name: "Statutory Deductions Payable", classification: "liability" },
    { code: "2103", name: "Employer Contributions Payable", classification: "liability" },
    { code: env("FINANCE_TDS_PAYABLE_CODE", "2200"), name: "TDS Payable", classification: "liability" },
    // income (4090 is contra-revenue: an income-side head that carries a debit balance)
    { code: env("FINANCE_CITIZEN_REVENUE_CODE", "4100"), name: "Citizen Service Fees", classification: "income" },
    { code: env("FINANCE_REVENUE_REFUND_CODE", "4090"), name: "Refunds (Contra Revenue)", classification: "income" },
    { code: env("FINANCE_REVENUE_INCOME_CODE", "4001"), name: "Revenue Income", classification: "income" },
    { code: env("FINANCE_BILLING_REVENUE_CODE", "4010"), name: "Billing Revenue", classification: "income" },
    { code: env("FINANCE_GAIN_LOSS_CODE", "4200"), name: "Gain/Loss on Asset Disposal", classification: "expense" },
    { code: env("FINANCE_FORFEIT_INCOME_CODE", "4300"), name: "Forfeited Deposits Income", classification: "income" },
    // expenses
    // the default head GRN and works bills are raised against (finance integrations / works billing consumers)
    { code: envTrim("FINANCE_GRN_BILL_HEAD_CODE", "2202"), name: "General Education", classification: "expense", hoaCode: BILL_HEAD_HOA },
    { code: envTrim("WORKS_FINANCE_BILL_HEAD_CODE", "2202"), name: "General Education", classification: "expense", hoaCode: BILL_HEAD_HOA },
    { code: "5001", name: "Salary Expense", classification: "expense" },
    { code: "5002", name: "Employer Contributions Expense", classification: "expense" },
    { code: DEP_EXPENSE, name: "Depreciation Expense", classification: "expense" },
    { code: DEP_EXPENSE_STAT, name: "Statutory Depreciation Expense", classification: "expense" },
    { code: env("FINANCE_IMPAIRMENT_CODE", "5200"), name: "Impairment Loss", classification: "expense" },
    { code: env("FINANCE_TDS_EXPENSE_CODE", "6100"), name: "TDS Expense", classification: "expense" },
  ];
  // Several roles share one code by default (1100 is the cash head for every path): keep the first definition.
  const seen = new Set<string>();
  return heads.filter((h) => {
    if (seen.has(h.code)) return false;
    seen.add(h.code);
    return true;
  });
}

/** The standard heads absent from `existing` (pure; drives the backfill's --dry-run plan). */
export function missingStandardHeads(existing: Iterable<string>): StandardGlHead[] {
  const have = new Set(existing);
  return standardGlHeads().filter((h) => !have.has(h.code));
}

type HeadWriter = {
  insert: (table: typeof financeHeads) => {
    values: (rows: Array<typeof financeHeads.$inferInsert>) => { onConflictDoNothing: (o: { target: unknown[] }) => Promise<unknown> };
  };
};

/**
 * Insert every standard head the tenant does not have yet. ON CONFLICT (tenant_id, code) DO NOTHING: a head the tenant
 * already has -- whatever its name or classification -- is left exactly as it is. Returns the number of standard heads.
 * Must run in a transaction scoped to `tenantId` (RLS).
 */
export async function seedStandardGlHeadsTx(tx: unknown, tenantId: string, actorId: string = SEED_ACTOR): Promise<number> {
  const rows = standardGlHeads().map((h) => ({
    tenantId, code: h.code, name: h.name, level: 0, classification: h.classification,
    hoaCode: h.hoaCode ?? null, isControl: h.isControl ?? false,
    createdBy: actorId, updatedBy: actorId,
  }));
  await (tx as HeadWriter).insert(financeHeads).values(rows)
    .onConflictDoNothing({ target: [financeHeads.tenantId, financeHeads.code] });
  return rows.length;
}
