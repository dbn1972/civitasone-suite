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
 *
 * Tenant-profile slice S4 (docs/design/TENANT-PROFILE-SWITCH.md 2.3): the list splits into CORE heads (every code a
 * posting path resolves by code; identical for every template) and TEMPLATE heads (the default bill head plus the
 * govt / commercial / nonprofit additions). seedGlHeadsTx seeds core + template. For `govt` with no packs the result is
 * EXACTLY the pre-S4 list (same rows, same order, no statementClass), asserted by the origin/main snapshot test.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { CoaTemplate } from "@civitasone/tenant-profile";
import { financeHeads } from "../budget/schema.js";
import { headNatureOf } from "../../shared/head-nature.js";
import { templateDefaultBillHead, DEP_EXPENSE, DEP_EXPENSE_STAT, ACCUM_DEP, FIXED_ASSET, STORES_INVENTORY, STORES_CONSUMPTION, GRNI, STORES_SUSPENSE, ASSET_SALE_RECEIPT, ACCUMULATED_FUND, payrollDeductionHeads } from "./system-heads.js";

/** The CHECK domain of budget.finance_heads.statement_class (migration 0169). */
export const STATEMENT_CLASSES = [
  "asset", "current_liability", "non_current_liability", "equity", "reserve", "income", "expense",
  "govt_equity", "capital_reserve", "dividend_payable",
] as const;
export type StatementClass = (typeof STATEMENT_CLASSES)[number];

export type SeedTemplate = CoaTemplate;

export type StandardGlHead = {
  code: string; name: string; classification: string;
  /** 18-digit PFMS Head of Account, for heads a bill is raised against (the bill consumer validates it, see hoa/domain.ts). */
  hoaCode?: string;
  /** A sub-ledger control account: manual journals may not post to it (GAP-FINANCE-JOURNAL-ENTRY-04). */
  isControl?: boolean;
  /**
   * Stored financial-statement class (budget.finance_heads.statement_class). Set only when a NON-govt template is
   * seeded; the govt seed leaves it unset so its rows stay byte-identical to the pre-S4 seed.
   */
  statementClass?: StatementClass;
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

/** Core heads that sort BEFORE the default-bill-head slot (two segments keep the govt row order unchanged). */
function coreHeadsPre(): StandardGlHead[] {
  return [
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
    // UAT T-PERIOD D-10: the employee deductions, each on its own liability head (2102 keeps LIC / other recoveries)
    { code: payrollDeductionHeads().gpf, name: "GPF Subscriptions Payable", classification: "liability" },
    { code: payrollDeductionHeads().nps, name: "NPS Employee Contributions Payable", classification: "liability" },
    { code: payrollDeductionHeads().pf, name: "EPF Employee Contributions Payable", classification: "liability" },
    { code: payrollDeductionHeads().esi, name: "ESI Employee Contributions Payable", classification: "liability" },
    { code: payrollDeductionHeads().pt, name: "Professional Tax Payable", classification: "liability" },
    { code: payrollDeductionHeads().tds, name: "TDS Payable", classification: "liability" },
    { code: payrollDeductionHeads().other, name: "Other Salary Deductions Payable (LIC / others)", classification: "liability" },
    // UAT T-PERIOD D-05: the fund the income / expenditure net is carried into at year end
    { code: ACCUMULATED_FUND, name: "Accumulated Fund (surplus brought forward)", classification: "equity" },
    { code: "2103", name: "Employer Contributions Payable", classification: "liability" },
    { code: env("FINANCE_TDS_PAYABLE_CODE", "2200"), name: "TDS Payable", classification: "liability" },
    // income (4090 is contra-revenue: an income-side head that carries a debit balance)
    { code: env("FINANCE_CITIZEN_REVENUE_CODE", "4100"), name: "Citizen Service Fees", classification: "income" },
    { code: env("FINANCE_REVENUE_REFUND_CODE", "4090"), name: "Refunds (Contra Revenue)", classification: "income" },
    { code: env("FINANCE_REVENUE_INCOME_CODE", "4001"), name: "Revenue Income", classification: "income" },
    { code: env("FINANCE_BILLING_REVENUE_CODE", "4010"), name: "Billing Revenue", classification: "income" },
    { code: env("FINANCE_GAIN_LOSS_CODE", "4200"), name: "Gain/Loss on Asset Disposal", classification: "expense" },
    { code: env("FINANCE_FORFEIT_INCOME_CODE", "4300"), name: "Forfeited Deposits Income", classification: "income" },
    // UAT T-PERIOD D-12: sale proceeds of a disposed asset (the only GL effect of a disposal on the cash basis)
    { code: ASSET_SALE_RECEIPT, name: "Sale Proceeds of Assets", classification: "income" },
  ];
}

/** Core heads that sort AFTER the default-bill-head slot. */
function coreHeadsPost(): StandardGlHead[] {
  return [
    { code: "5001", name: "Salary Expense", classification: "expense" },
    { code: "5002", name: "Employer Contributions Expense", classification: "expense" },
    { code: DEP_EXPENSE, name: "Depreciation Expense", classification: "expense" },
    { code: DEP_EXPENSE_STAT, name: "Statutory Depreciation Expense", classification: "expense" },
    { code: env("FINANCE_IMPAIRMENT_CODE", "5200"), name: "Impairment Loss", classification: "expense" },
    { code: env("FINANCE_TDS_EXPENSE_CODE", "6100"), name: "TDS Expense", classification: "expense" },
  ];
}

/**
 * The default head GRN and works bills are raised against, per template (finance integrations / works billing
 * consumers). govt: 2202 General Education with its HoA (exactly the pre-S4 pair). commercial / nonprofit: 5400 with no
 * HoA (chk_finance_heads_hoa_code allows NULL). The two env vars still win when set.
 */
function defaultBillHeads(template: SeedTemplate): StandardGlHead[] {
  const code = (name: string) => envTrim(name, templateDefaultBillHead(template));
  if (template === "govt") {
    return [
      { code: code("FINANCE_GRN_BILL_HEAD_CODE"), name: "General Education", classification: "expense", hoaCode: BILL_HEAD_HOA },
      { code: code("WORKS_FINANCE_BILL_HEAD_CODE"), name: "General Education", classification: "expense", hoaCode: BILL_HEAD_HOA },
    ];
  }
  const name = template === "commercial" ? "Purchases and Direct Expenses" : "Programme Expenses";
  return [
    { code: code("FINANCE_GRN_BILL_HEAD_CODE"), name, classification: "expense", statementClass: "expense" },
    { code: code("WORKS_FINANCE_BILL_HEAD_CODE"), name, classification: "expense", statementClass: "expense" },
  ];
}

const th = (code: string, name: string, classification: string, statementClass: StatementClass): StandardGlHead =>
  ({ code, name, classification, statementClass });

/** Template heads other than the default bill head (docs/design/TENANT-PROFILE-SWITCH.md 2.3). Codes avoid every core code. */
function templateAdditions(template: SeedTemplate): StandardGlHead[] {
  if (template === "commercial") {
    return [
      th("1500", "Advances and Deposits Paid", "asset", "asset"),
      th("1600", "Prepaid Expenses", "asset", "asset"),
      th("1700", "GST Input Credit", "asset", "asset"),
      th("1800", "TDS Receivable", "asset", "asset"),
      th("2300", "GST Payable", "liability", "current_liability"),
      th("2310", "Income Tax Payable", "liability", "current_liability"),
      th("2400", "Short-term Borrowings", "liability", "current_liability"),
      th("2500", "Accrued Expenses", "liability", "current_liability"),
      th("3000", "Share Capital / Proprietor's Capital", "equity", "equity"),
      th("3200", "Reserves and Surplus", "equity", "reserve"),
      th("4400", "Interest Income", "income", "income"),
      th("5410", "Rent and Utilities", "expense", "expense"),
      th("5420", "Professional Fees", "expense", "expense"),
      th("5430", "Travel and Conveyance", "expense", "expense"),
      th("5440", "Repairs and Maintenance", "expense", "expense"),
      th("5450", "Office Administration", "expense", "expense"),
      th("6200", "Bank Charges and Interest", "expense", "expense"),
    ];
  }
  if (template === "nonprofit") {
    return [
      th("1500", "Advances and Deposits Paid", "asset", "asset"),
      th("1550", "Grants Receivable", "asset", "asset"),
      th("2300", "Unutilised Grants", "liability", "current_liability"),
      th("2310", "FCRA Foreign Contribution Unutilised", "liability", "current_liability"),
      th("3000", "Corpus Fund", "equity", "equity"),
      th("3200", "Restricted and Designated Funds", "equity", "reserve"),
      th("4400", "Grants and Donations Received", "income", "income"),
      th("4410", "Membership Fees", "income", "income"),
      th("4420", "Interest on Investments", "income", "income"),
      th("5410", "Staff Costs", "expense", "expense"),
      th("5420", "Administrative Expenses", "expense", "expense"),
      th("5430", "Fundraising Expenses", "expense", "expense"),
      th("5440", "Grants Disbursed to Partners", "expense", "expense"),
      th("6200", "Bank Charges", "expense", "expense"),
    ];
  }
  return [];
}

/** The govt `office-pack` (govt_small_office): add-only expense heads. Never part of standardGlHeads(). */
const OFFICE_PACK: StandardGlHead[] = [
  { code: "5410", name: "Office Expenses", classification: "expense" },
  { code: "5420", name: "Travel Expenses (TA/DA)", classification: "expense" },
  { code: "5430", name: "Contingent Expenditure", classification: "expense" },
  { code: "5440", name: "Repairs and Maintenance", classification: "expense" },
  { code: "5450", name: "Vehicle Hire and POL", classification: "expense" },
  { code: "5460", name: "Electricity, Water and Telephone", classification: "expense" },
];

function dedupe(heads: StandardGlHead[]): StandardGlHead[] {
  // Several roles share one code by default (1100 is the cash head for every path): keep the first definition.
  const seen = new Set<string>();
  return heads.filter((h) => {
    if (seen.has(h.code)) return false;
    seen.add(h.code);
    return true;
  });
}

/**
 * CORE heads: every code a posting path resolves by code. Identical for every template; excludes the template-specific
 * default bill head; carries no statementClass.
 */
export function coreGlHeads(): StandardGlHead[] {
  return dedupe([...coreHeadsPre(), ...coreHeadsPost()]);
}

/** TEMPLATE heads: the default bill head(s) plus the template additions (and, for govt, the requested packs). */
export function templateGlHeads(template: SeedTemplate, packs: readonly string[] = []): StandardGlHead[] {
  const packHeads = template === "govt" && packs.includes("office-pack") ? OFFICE_PACK : [];
  return dedupe([...defaultBillHeads(template), ...templateAdditions(template), ...packHeads]);
}

function coreStatementClass(x: StandardGlHead): StatementClass {
  const nature = headNatureOf(x.code, x.classification);
  return nature === "liability" ? "current_liability" : nature;
}

/**
 * The full seed list for a template: core + template heads. For `govt` with no packs this is EXACTLY the pre-S4
 * standardGlHeads() (same rows, same order, no statementClass key). For commercial / nonprofit (and govt + a pack) the
 * core heads follow the template heads' convention: a non-govt template stamps every head, core included, with its
 * stored statementClass (derived for core heads from head-nature.ts); govt rows never carry one.
 */
export function glHeadsForTemplate(template: SeedTemplate, packs: readonly string[] = []): StandardGlHead[] {
  if (template === "govt" && packs.length === 0) {
    return dedupe([...coreHeadsPre(), ...defaultBillHeads("govt"), ...coreHeadsPost()]);
  }
  const core = coreGlHeads().map((x): StandardGlHead => (template === "govt" ? x : { ...x, statementClass: coreStatementClass(x) }));
  const have = new Set(core.map((x) => x.code));
  return [...core, ...templateGlHeads(template, packs).filter((x) => !have.has(x.code))];
}

/** The govt standard list (default bill head 2202). Unchanged output vs. pre-S4; kept for the backfill, tests and callers. */
export function standardGlHeads(): StandardGlHead[] {
  return glHeadsForTemplate("govt");
}

/**
 * UAT L2-N6 review: the stores heads only an ACCRUAL-basis tenant posts to (gl/inventory-movement.ts). Never seeded at
 * provisioning (a new tenant is cash basis); scripts/backfill-standard-gl-heads.ts adds them for accrual tenants only.
 */
export function accrualStoresHeads(): StandardGlHead[] {
  return [
    { code: STORES_INVENTORY, name: "Stores / Inventory", classification: "asset" },
    { code: GRNI, name: "Goods Received Not Invoiced (GRNI)", classification: "liability" },
    { code: STORES_SUSPENSE, name: "Stores Receipts Suspense", classification: "liability" },
    { code: STORES_CONSUMPTION, name: "Stores Consumed", classification: "expense" },
  ];
}

/** The accrual stores heads absent from `existing` (pure). */
export function missingAccrualStoresHeads(existing: Iterable<string>): StandardGlHead[] {
  const have = new Set(existing);
  return accrualStoresHeads().filter((h) => !have.has(h.code));
}

/** The standard heads absent from `existing` (pure; drives the backfill's --dry-run plan). Optional template (default govt). */
export function missingStandardHeads(existing: Iterable<string>, template: SeedTemplate = "govt", packs: readonly string[] = []): StandardGlHead[] {
  const have = new Set(existing);
  return glHeadsForTemplate(template, packs).filter((h) => !have.has(h.code));
}

type HeadWriter = {
  insert: (table: typeof financeHeads) => {
    values: (rows: Array<typeof financeHeads.$inferInsert>) => { onConflictDoNothing: (o: { target: unknown[] }) => Promise<unknown> };
  };
};

/** Thrown by the non-govt seed when a tenant already has a head under a template code with a DIFFERENT classification. */
export class CoaTemplateCollisionError extends Error {
  constructor(public readonly collisions: Array<{ code: string; existing: string | null; template: string }>) {
    super(`[COA_TEMPLATE_COLLISION] tenant already uses template head code(s) for another purpose: ${
      collisions.map((c) => `${c.code} (existing ${c.existing ?? "none"}, template ${c.template})`).join(", ")}`);
    this.name = "CoaTemplateCollisionError";
  }
}

/**
 * Seed the tenant's chart for `template`. ON CONFLICT (tenant_id, code) DO NOTHING: a head the tenant already has is left
 * exactly as it is, so the call is add-only and idempotent. Inserts ONLY into the tenant table budget.finance_heads --
 * never the global budget.finance_major_heads. Returns the number of heads in the list.
 *
 * Collision guard (non-govt templates only): if a head already exists under a template code with a DIFFERENT
 * classification (e.g. a govt tenant already using 2300 / 3000 as a liability), abort with CoaTemplateCollisionError
 * BEFORE writing anything -- DO NOTHING alone would silently skip it and leave the tenant with a wrong-meaning code.
 * The govt path performs no extra query, so its behaviour is exactly the pre-S4 seed.
 *
 * Must run in a transaction scoped to `tenantId` (RLS).
 */
export async function seedGlHeadsTx(
  tx: unknown, tenantId: string, template: SeedTemplate = "govt", packs: readonly string[] = [], actorId: string = SEED_ACTOR,
): Promise<number> {
  const heads = glHeadsForTemplate(template, packs);
  if (template !== "govt") await assertNoCollisionTx(tx, tenantId, heads);
  const rows = heads.map((h) => ({
    tenantId, code: h.code, name: h.name, level: 0, classification: h.classification,
    hoaCode: h.hoaCode ?? null, isControl: h.isControl ?? false,
    ...(h.statementClass ? { statementClass: h.statementClass } : {}),
    createdBy: actorId, updatedBy: actorId,
  }));
  await (tx as HeadWriter).insert(financeHeads).values(rows)
    .onConflictDoNothing({ target: [financeHeads.tenantId, financeHeads.code] });
  return rows.length;
}

type HeadReader = {
  select: (cols: { code: typeof financeHeads.code; classification: typeof financeHeads.classification }) => {
    from: (t: typeof financeHeads) => { where: (c: unknown) => Promise<Array<{ code: string; classification: string | null }>> };
  };
};

async function assertNoCollisionTx(tx: unknown, tenantId: string, heads: StandardGlHead[]): Promise<void> {
  const existing = await (tx as HeadReader).select({ code: financeHeads.code, classification: financeHeads.classification })
    .from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.code, heads.map((h) => h.code))));
  const byCode = new Map(heads.map((h) => [h.code, h]));
  const collisions = existing
    .filter((e) => (e.classification ?? "").trim().toLowerCase() !== byCode.get(e.code)!.classification)
    .map((e) => ({ code: e.code, existing: e.classification, template: byCode.get(e.code)!.classification }));
  if (collisions.length > 0) throw new CoaTemplateCollisionError(collisions);
}

/** Back-compat: the pre-S4 govt seed. Same rows as seedGlHeadsTx(tx, tenantId, "govt"). */
export async function seedStandardGlHeadsTx(tx: unknown, tenantId: string, actorId: string = SEED_ACTOR): Promise<number> {
  return seedGlHeadsTx(tx, tenantId, "govt", [], actorId);
}
