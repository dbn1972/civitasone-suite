/**
 * MSME M8: data loaders for the commercial statements (commercial-statements.ts renders them).
 * Read-only, tenant-scoped, in the caller's transaction. REUSES the govt year-end `fyBalances` reader (opening roll-forward +
 * FY movements per head) without modifying it, and joins the STORED statement_class onto each row.
 */
import { sql } from "drizzle-orm";
import { assertCommercialChartReadyTx } from "../gl/commercial-chart.js";
import { ACCUMULATED_FUND, ACCUM_DEP, DEP_EXPENSE, DEP_EXPENSE_STAT, FIXED_ASSET, STORES_CONSUMPTION } from "../gl/system-heads.js";
import { fyBalances, type Tx } from "../year-end/repo.js";
import type { CommercialRow, Framework, PresentationConfig } from "./commercial-statements.js";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];

export type StatementSettings = { coaTemplate: string | null; entityType: string | null; accountingBasis: string; accountingStandard: Framework | null };

/** The stored settings the selector keys on (never an edition / profile). No settings row => govt (resolver fail-safe). */
export async function loadStatementSettings(tx: Tx, tenantId: string): Promise<StatementSettings> {
  const [r] = rowsOf(await tx.execute(sql`SELECT coa_template, entity_type, accounting_basis, accounting_standard FROM gl.finance_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`));
  return { coaTemplate: (r?.coa_template as string | null) ?? null, entityType: (r?.entity_type as string | null) ?? null, accountingBasis: (r?.accounting_basis as string | null) ?? "cash", accountingStandard: toFramework(r?.accounting_standard) };
}

/** Line-grouping codes inside the stored classes: the shared system-head codes (system-heads.ts) + the commercial chart's seeded codes. */
export function commercialPresentation(): PresentationConfig {
  const set = (...c: string[]) => new Set(c);
  return {
    accumulatedFund: ACCUMULATED_FUND,
    fixedAssetCodes: set(FIXED_ASSET), accumDepCodes: set(ACCUM_DEP),
    cashCodes: set("1100", "1101"),
    borrowingCodes: set("2400"),
    otherIncomeCodes: set("4400", "4300", "4310"),
    directExpenseCodes: set("5400", STORES_CONSUMPTION),
    employeeCodes: set("5001", "5002"),
    financeCostCodes: set("6200"),
    depreciationCodes: set(DEP_EXPENSE, DEP_EXPENSE_STAT),
    taxExpenseCodes: set(),
    dividendCodes: set(),
  };
}

const toFramework = (v: unknown): Framework | null => (v === "as" || v === "ind_as" ? v : null);

/** PSU v1-A: the framework a tenant renders under = its STORED per-tenant accounting_standard; NULL (never chosen) falls back to the deployment default. */
export function resolveFramework(stored: Framework | null | undefined, env: NodeJS.ProcessEnv): Framework {
  return stored ?? frameworkFromEnv(env);
}

/** Deployment default, CA-VERIFY: AS (default) vs Ind AS. Used only when the tenant has not stored an accounting_standard. */
export function frameworkFromEnv(env: NodeJS.ProcessEnv): Framework {
  return env.FINANCE_COMMERCIAL_ACCOUNTING_STANDARD?.trim().toLowerCase() === "ind_as" ? "ind_as" : "as";
}

/** Per-head FY balances with the stored statement_class. Fail-closed: the commercial chart must be complete (M1). */
export async function loadCommercialRows(tx: Tx, tenantId: string, fy: string): Promise<CommercialRow[]> {
  await assertCommercialChartReadyTx(tx, tenantId);
  return loadRowsForFy(tx, tenantId, fy);
}

/** The chart-readiness assertion is done once by loadCommercialRows; this reads another year's rows (P&L prior-year comparative). */
export async function loadRowsForFy(tx: Tx, tenantId: string, fy: string): Promise<CommercialRow[]> {
  const { rows } = await fyBalances(tx, tenantId, fy);
  const classes = new Map(rowsOf(await tx.execute(sql`
    SELECT code, statement_class FROM budget.finance_heads WHERE tenant_id = ${tenantId}::uuid AND statement_class IS NOT NULL
  `)).map((x) => [String(x.code), String(x.statement_class)]));
  return rows.map((r) => ({
    code: r.code, name: r.name, statementClass: classes.get(r.code) ?? null,
    openingMinor: r.openingMinor, debitMinor: r.debitMinor, creditMinor: r.creditMinor, closingMinor: r.closingMinor,
  }));
}
