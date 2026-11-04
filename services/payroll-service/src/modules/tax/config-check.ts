/**
 * UAT b18 D2: a payroll run for a financial year with no income-tax slab
 * configuration used to be accepted (202) and then fail for every employee
 * during compute (UnconfiguredFyError from tax/engine.ts). It is now refused
 * at run creation with 422 TAX_CONFIG_MISSING, with details.
 *
 * ERP-head decision 2026-11-05 (PR #2458): the new regime is the default
 * since FY 2023-24 (s.115BAC(1A)) and the old regime is an option, so
 *   - the NEW-regime slabs for the FY are always required;
 *   - the OLD-regime slabs only when an employee in the run opted for the old
 *     regime for that FY.
 * The regime is the one compute uses (payroll/consumer.ts): the employee's tax
 * declaration for the FY, else the HRMS tax regime, else new. Employees in the
 * run: payroll-eligible HRMS employees, narrowed to the department or the pay
 * group(s) when the run is scoped to them; a DDO-wide run is checked against
 * the whole tenant (it may over-include, never miss). A pensioner run needs
 * the new-regime slabs only. HRMS is asked only when the old-regime slabs are
 * missing; if it is unreachable the run is refused (502 HRMS_UNAVAILABLE).
 *
 * Config rows come from payroll.tax_slab_config (tenant override or the
 * platform default, platform_default_read_policy of migration 0039).
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { fetchPayrollInput, HrmsUnavailableError } from "../../shared/hrms-client.js";
import { isPayrollEligible } from "../payroll/domain.js";
import { resolveMonthMembers } from "../payroll/pay-group-repo.js";
import { fyStartYearForMonth, PLATFORM_DEFAULT_TENANT_ID, type Regime } from "./engine.js";

export const TAX_CONFIG_MISSING = "TAX_CONFIG_MISSING";
const REGIMES: readonly Regime[] = ["new", "old"];
/** Old-regime employees named in the message (details carries them all). */
const NAMED_IN_MESSAGE = 10;

export interface TaxConfigMissingDetails {
  fy: string;
  missingRegimes: Regime[];
  /** When the old-regime slabs are missing: the employees in the run who opted for it. */
  oldRegimeEmployees?: Array<{ employeeId: string; employeeNo: string | null }>;
}

/** 422 TAX_CONFIG_MISSING with the FY, the missing regime and who needs it. */
export class TaxConfigMissingError extends HttpError {
  constructor(message: string, public details: TaxConfigMissingDetails) {
    super(422, TAX_CONFIG_MISSING, message);
  }
}

/** "2027-28" for 2027. */
export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Pure: the regimes with no configured row among `configured`. */
export function missingRegimes(configured: readonly string[]): Regime[] {
  return REGIMES.filter((r) => !configured.includes(r));
}

export interface RegimeCandidate {
  id: string;
  employeeNo?: string | null;
  taxRegime?: string | null;
  departmentId?: string | null;
  paymentRoute?: string | null;
  eligibleForPayroll?: boolean | null;
}

/** Pure: employees in the run scope whose regime for the FY is old (declaration, then HRMS, else new). */
export function oldRegimeEmployees(
  employees: readonly RegimeCandidate[],
  declaredRegime: ReadonlyMap<string, string>,
  scope: { departmentId?: string; memberIds?: ReadonlySet<string> },
): Array<{ employeeId: string; employeeNo: string | null }> {
  return employees
    .filter((e) => isPayrollEligible(e))
    .filter((e) => !scope.departmentId || e.departmentId === scope.departmentId)
    .filter((e) => !scope.memberIds || scope.memberIds.has(e.id))
    .filter((e) => (declaredRegime.get(e.id) ?? e.taxRegime ?? "new") === "old")
    .map((e) => ({ employeeId: e.id, employeeNo: e.employeeNo ?? null }));
}

export interface RunScope {
  month: string;
  runType?: string;
  departmentId?: string;
  payGroupId?: string;
  payGroupIds?: string[];
}

/** Throws TaxConfigMissingError (422) when the run cannot compute tax for its FY. */
export async function assertTaxConfigForRun(tenantId: string, run: RunScope): Promise<void> {
  const fyStart = fyStartYearForMonth(run.month);
  const fy = fyLabel(fyStart);
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT DISTINCT regime FROM payroll.tax_slab_config
    WHERE fy_start_year = ${fyStart}
      AND tenant_id IN (${tenantId}::uuid, ${PLATFORM_DEFAULT_TENANT_ID}::uuid)
  `))) as unknown as Array<{ regime: string }>;
  const missing = missingRegimes((rows ?? []).map((r) => r.regime));
  if (missing.includes("new")) {
    throw new TaxConfigMissingError(
      `No new-regime income-tax slab configuration for FY ${fy}. Configure the FY ${fy} tax slabs before creating a payroll run for ${run.month}.`,
      { fy, missingRegimes: ["new"] },
    );
  }
  if (!missing.includes("old") || run.runType === "pensioner") return;

  let employees: RegimeCandidate[];
  try {
    employees = (await fetchPayrollInput(tenantId, run.month)).employees as unknown as RegimeCandidate[];
  } catch (err) {
    if (err instanceof HrmsUnavailableError) {
      throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot check the employees' tax regime: HRMS payroll input unreachable");
    }
    throw err;
  }
  const groupIds = run.payGroupIds ?? (run.payGroupId ? [run.payGroupId] : []);
  let memberIds: Set<string> | undefined;
  if (groupIds.length > 0) {
    const members = await scopedRead((tx) => resolveMonthMembers(tx as never, tenantId, run.month));
    memberIds = new Set([...members].filter(([, g]) => groupIds.includes(g)).map(([e]) => e));
  }
  const ids = (employees ?? []).map((e) => e.id);
  const declared = new Map<string, string>();
  if (ids.length > 0) {
    const decl = (await scopedRead((tx) => tx.execute(sql`
      SELECT DISTINCT ON (employee_id) employee_id, regime FROM payroll.payroll_tax_declarations
      WHERE tenant_id = ${tenantId}::uuid AND fy = ${fy}
        AND employee_id = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`})
      ORDER BY employee_id, created_at DESC
    `))) as unknown as Array<{ employee_id: string; regime: string }>;
    for (const d of decl ?? []) declared.set(d.employee_id, d.regime);
  }
  const scope = { ...(run.departmentId ? { departmentId: run.departmentId } : {}), ...(memberIds ? { memberIds } : {}) };
  const old = oldRegimeEmployees(employees ?? [], declared, scope);
  if (old.length > 0) {
    const named = old.slice(0, NAMED_IN_MESSAGE).map((e) => e.employeeNo ?? e.employeeId).join(", ");
    const more = old.length > NAMED_IN_MESSAGE ? ` and ${old.length - NAMED_IN_MESSAGE} more` : "";
    throw new TaxConfigMissingError(
      `No old-regime income-tax slab configuration for FY ${fy}, but ${old.length} employee(s) in this run opted for the old regime: ${named}${more}. Configure the FY ${fy} old-regime slabs before creating a payroll run for ${run.month}.`,
      { fy, missingRegimes: ["old"], oldRegimeEmployees: old },
    );
  }
}
