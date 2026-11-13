/**
 * S8 statutory seams: reads for the payroll run and the LWF ledger write.
 * All reads run inside the caller's tx (FORCE RLS). See statutory-seams.ts.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import type { db } from "../../shared/db.js";
import type { PfWageBasisRow, LwfRule, LwfFrequency } from "./statutory-seams.js";

type Tx = typeof db;
export const seamLog = pino({ name: "payroll-s8-seams" });

/**
 * Deploy-order safety: these reads run for EVERY tenant on every run, so code
 * deployed before migration 0167 must not fail payroll. A missing relation
 * (what a 42P01 would report) means "seams unused": defaults, logged once.
 * A to_regclass() probe is used instead of catching 42P01 because a failed
 * statement would abort the surrounding transaction.
 */
let missingLogged = false;
export function resetSeamTablesMissingLogForTest(): void { missingLogged = false; }
export async function seamTablesPresent(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT to_regclass('payroll.payroll_statutory_seams') IS NOT NULL
       AND to_regclass('payroll.employee_pf_wage_basis') IS NOT NULL
       AND to_regclass('payroll.payroll_lwf_ledger') IS NOT NULL AS ok
  `)) as unknown as Array<{ ok: boolean }>;
  const ok = rows[0]?.ok === true;
  if (!ok && !missingLogged) {
    missingLogged = true;
    seamLog.warn("S8 statutory-seams tables are missing (migration 0167 not applied): seams treated as OFF");
  }
  return ok;
}
const idList = (ids: readonly string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;

export interface SeamFlags { lwfDeductionEnabled: boolean; esiContributionPeriodEnabled: boolean }
export const SEAMS_OFF: SeamFlags = { lwfDeductionEnabled: false, esiContributionPeriodEnabled: false };

/** A tenant with no row is OFF. */
export async function resolveSeamFlags(tx: Tx, tenantId: string): Promise<SeamFlags> {
  if (!(await seamTablesPresent(tx))) return SEAMS_OFF;
  const rows = (await tx.execute(sql`
    SELECT lwf_deduction_enabled, esi_contribution_period_enabled
      FROM payroll.payroll_statutory_seams WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ lwf_deduction_enabled: boolean; esi_contribution_period_enabled: boolean }>;
  const r = rows[0];
  return r ? { lwfDeductionEnabled: r.lwf_deduction_enabled === true, esiContributionPeriodEnabled: r.esi_contribution_period_enabled === true } : SEAMS_OFF;
}

export async function pfWageBasisRowsByEmployee(tx: Tx, tenantId: string, employeeIds: readonly string[]): Promise<Map<string, PfWageBasisRow[]>> {
  const out = new Map<string, PfWageBasisRow[]>();
  if (employeeIds.length === 0) return out;
  if (!(await seamTablesPresent(tx))) return out;
  const rows = (await tx.execute(sql`
    SELECT employee_id::text AS employee_id, effective_from::text AS effective_from, basis
      FROM payroll.employee_pf_wage_basis
     WHERE tenant_id = ${tenantId}::uuid AND employee_id = ANY(${idList(employeeIds)})
     ORDER BY effective_from
  `)) as unknown as Array<{ employee_id: string; effective_from: string; basis: "ceiling" | "actual" }>;
  for (const r of rows) {
    const list = out.get(r.employee_id) ?? [];
    list.push({ effectiveFrom: r.effective_from, basis: r.basis });
    out.set(r.employee_id, list);
  }
  return out;
}

/** The LWF rule in force on the last day of `month` for each state (latest effective_from wins). */
export async function lwfRulesByState(tx: Tx, tenantId: string, stateCodes: readonly string[], month: string): Promise<Map<string, LwfRule>> {
  const out = new Map<string, LwfRule>();
  if (stateCodes.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (state_code) state_code, employee_contrib_minor::text AS emp, employer_contrib_minor::text AS er, frequency
      FROM payroll.payroll_lwf
     WHERE tenant_id = ${tenantId}::uuid AND state_code = ANY(${sql`ARRAY[${sql.join(stateCodes.map((s) => sql`${s}`), sql`, `)}]::text[]`})
       AND effective_from <= (${`${month}-01`}::date + INTERVAL '1 month' - INTERVAL '1 day')::date
     ORDER BY state_code, effective_from DESC
  `)) as unknown as Array<{ state_code: string; emp: string; er: string; frequency: string }>;
  for (const r of rows) out.set(r.state_code, { employeeMinor: BigInt(r.emp), employerMinor: BigInt(r.er), frequency: r.frequency as LwfFrequency });
  return out;
}

/**
 * Months (YYYY-MM) from the ESI contribution period start up to (not including)
 * `month` in which the employee had an ESI deduction on a slip of a finalised
 * (approved / disbursed) run. Same finalised-runs-only rule as the PT / TDS YTD reads.
 */
export async function esiCoveredMonthsByEmployee(tx: Tx, tenantId: string, employeeIds: readonly string[], periodStart: string, month: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (employeeIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT s.employee_id::text AS employee_id, r.month AS month
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId}::uuid AND s.employee_id = ANY(${idList(employeeIds)})
       AND s.esi_minor > 0 AND s.status <> 'excluded'
       AND r.status IN ('approved', 'disbursed')
       AND r.month >= ${periodStart} AND r.month < ${month}
  `)) as unknown as Array<{ employee_id: string; month: string }>;
  for (const r of rows) {
    const list = out.get(r.employee_id) ?? [];
    list.push(r.month);
    out.set(r.employee_id, list);
  }
  return out;
}

/**
 * Employees that already have an LWF ledger row for `period` from ANOTHER run that is still live
 * (not cancelled / failed): LWF is one contribution per employee per period, so a later
 * run (re-run, second regular run) must not deduct it again.
 */
export async function lwfAlreadyAppliedEmployees(tx: Tx, tenantId: string, period: string, employeeIds: readonly string[], thisRunId: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (employeeIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT DISTINCT l.employee_id::text AS employee_id
      FROM payroll.payroll_lwf_ledger l
      JOIN payroll.payroll_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId}::uuid AND l.period = ${period} AND l.run_id <> ${thisRunId}::uuid
       AND l.employee_id = ANY(${idList(employeeIds)})
       AND r.status NOT IN ('cancelled', 'failed')
  `)) as unknown as Array<{ employee_id: string }>;
  for (const r of rows) out.add(r.employee_id);
  return out;
}

/** Ledger rows are written for every run that computed LWF, including runs later rejected / cancelled: readers MUST join payroll_runs and filter on its status. */
export async function insertLwfLedger(tx: Tx, row: {
  tenantId: string; slipId: string; runId: string; employeeId: string; stateCode: string; period: string;
  frequency: string; employeeMinor: bigint; employerMinor: bigint;
}): Promise<void> {
  await tx.execute(sql`
    INSERT INTO payroll.payroll_lwf_ledger (tenant_id, slip_id, run_id, employee_id, state_code, period, frequency, employee_minor, employer_minor)
    VALUES (${row.tenantId}::uuid, ${row.slipId}::uuid, ${row.runId}::uuid, ${row.employeeId}::uuid, ${row.stateCode}, ${row.period},
            ${row.frequency}, ${row.employeeMinor.toString()}::bigint, ${row.employerMinor.toString()}::bigint)
    ON CONFLICT (tenant_id, slip_id) DO NOTHING
  `);
}
