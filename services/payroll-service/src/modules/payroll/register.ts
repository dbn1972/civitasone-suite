/**
 * GAP-PAYROLL-REGISTER-WRITER: the writer side of payroll.payroll_register.
 *
 * Nothing used to write this table, so GET /v1/payroll/register and
 * GET /v1/payroll/comparison (hasData) were always empty. The contract the
 * existing readers assume (repo.ts listRegister / getRegisterSummary, the
 * web /hr/payroll/register and /hr/payroll/comparison pages):
 *
 *   - grain: ONE ROW PER (run, department) -- listRegister filters by run_id
 *     and orders by department_name; getRegisterSummary SUMs every row of a
 *     period, so a month with a regular run plus a supplementary/arrears run
 *     reports their combined cost;
 *   - money: BIGINT paise, aggregated from the run's slips -- never
 *     recomputed. total_pf_minor is the EPF employee share; GPF/NPS have no
 *     column until migration 0067 (total_gpf_minor / total_nps_minor now
 *     carry them; the register page shows the unlisted remainder as "Other
 *     deductions"); total_pt_minor is the slip
 *     component coded "PT";
 *   - period: the run's month (YYYY-MM).
 *
 * Slips do not persist a department, so the caller supplies an
 * employeeId -> department map (resolveRegisterDepartments). Rows are rebuilt
 * delete-then-insert per run inside the caller's transaction, so a rerun is
 * idempotent and a rolled-back compute leaves nothing behind.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import type { db } from "../../shared/db.js";
import { fetchEmployeeSummaries, type PayrollInputEmployee } from "../../shared/hrms-client.js";
import * as repo from "./repo.js";
import type { PayrollSlipRow } from "./schema.js";

type Tx = typeof db;

const log = pino({ name: "payroll-register" });

export type RegisterDepartment = { departmentId: string | null; departmentName: string | null };

export type RegisterRow = {
  departmentId: string | null;
  departmentName: string | null;
  employeeCount: number;
  totalGrossMinor: bigint;
  totalDeductionsMinor: bigint;
  totalNetMinor: bigint;
  totalPfMinor: bigint;
  totalEsiMinor: bigint;
  totalTdsMinor: bigint;
  totalPtMinor: bigint;
  // GAP-PAYROLL-REGISTER-04: Govt-edition deductions (migration 0067).
  totalGpfMinor: bigint;
  totalNpsMinor: bigint;
};

const PT_CODE = "PT";

function ptOf(slip: Pick<PayrollSlipRow, "components">): bigint {
  let pt = 0n;
  for (const c of slip.components ?? []) {
    if (c.code === PT_CODE && c.type === "deduction") pt += BigInt(c.amountMinor);
  }
  return pt;
}

/**
 * Pure aggregation: one RegisterRow per department. Slips whose employee has
 * no known department share a single null-department row ("Unassigned").
 */
export function aggregateRegister(
  slips: PayrollSlipRow[],
  departments: Map<string, RegisterDepartment>,
): RegisterRow[] {
  const groups = new Map<string, RegisterRow>();
  for (const slip of slips) {
    const dept = departments.get(slip.employeeId) ?? { departmentId: null, departmentName: null };
    const key = dept.departmentId ? `id:${dept.departmentId}` : dept.departmentName ? `name:${dept.departmentName}` : "none";
    let row = groups.get(key);
    if (!row) {
      row = {
        departmentId: dept.departmentId, departmentName: dept.departmentName, employeeCount: 0,
        totalGrossMinor: 0n, totalDeductionsMinor: 0n, totalNetMinor: 0n,
        totalPfMinor: 0n, totalEsiMinor: 0n, totalTdsMinor: 0n, totalPtMinor: 0n,
        totalGpfMinor: 0n, totalNpsMinor: 0n,
      };
      groups.set(key, row);
    }
    if (!row.departmentName && dept.departmentName) row.departmentName = dept.departmentName;
    row.employeeCount += 1;
    row.totalGrossMinor += slip.grossMinor;
    row.totalDeductionsMinor += slip.totalDeductionsMinor;
    row.totalNetMinor += slip.netPayMinor;
    row.totalPfMinor += slip.pfEmployeeMinor;
    row.totalEsiMinor += slip.esiMinor;
    row.totalTdsMinor += slip.tdsMinor;
    row.totalPtMinor += ptOf(slip);
    row.totalGpfMinor += slip.gpfMinor;
    // Employee NPS contribution only: the employer share is a cost, not a deduction.
    row.totalNpsMinor += slip.npsEmployeeMinor;
  }
  return [...groups.values()];
}

/** HRMS employee-summaries returns at most this many rows, unordered. */
export const EMPLOYEE_SUMMARIES_CAP = 2000;

/**
 * employeeId -> department for a run. departmentId comes from the HRMS
 * payroll-input feed the run was computed from; the name from HRMS
 * employee-summaries, which is display enrichment only: if it is unavailable
 * the rows are still written (name NULL, shown as "Unassigned") rather than
 * failing the payroll run -- a warning is logged, and
 * `pnpm backfill:payroll-register --rebuild` repairs the names later.
 * employee-summaries is capped at EMPLOYEE_SUMMARIES_CAP unordered rows with
 * no paging or by-id filter, so a larger tenant can get some names missing;
 * that case is logged too.
 */
export async function resolveRegisterDepartments(
  tenantId: string,
  employees: Array<Pick<PayrollInputEmployee, "id" | "departmentId">>,
  context: { runId?: string } = {},
): Promise<Map<string, RegisterDepartment>> {
  let summaries = new Map<string, { departmentName: string }>();
  try {
    summaries = await fetchEmployeeSummaries(tenantId);
  } catch {
    summaries = new Map();
  }
  // fetchEmployeeSummaries itself swallows HTTP failures into an empty map.
  if (summaries.size === 0 && employees.length > 0) {
    log.warn({ tenantId, runId: context.runId }, "payroll register: HRMS employee-summaries unavailable; department names left empty");
  } else if (summaries.size >= EMPLOYEE_SUMMARIES_CAP) {
    log.warn({ tenantId, runId: context.runId, cap: EMPLOYEE_SUMMARIES_CAP }, "payroll register: HRMS employee-summaries hit its row cap; some department names may be missing");
  }

  const nameByDeptId = new Map<string, string>();
  for (const emp of employees) {
    const name = summaries.get(emp.id)?.departmentName?.trim();
    if (emp.departmentId && name && !nameByDeptId.has(emp.departmentId)) nameByDeptId.set(emp.departmentId, name);
  }
  // name -> departmentId, only where the name maps to exactly one id, so an
  // employee missing from the feed (e.g. separated since the run) joins the
  // same department row instead of a second, id-less row of the same name.
  const idByName = new Map<string, string | null>();
  for (const [deptId, name] of nameByDeptId) {
    idByName.set(name, idByName.has(name) && idByName.get(name) !== deptId ? null : deptId);
  }

  const out = new Map<string, RegisterDepartment>();
  for (const [id, s] of summaries) {
    const name = s.departmentName?.trim() || null;
    out.set(id, { departmentId: name ? idByName.get(name) ?? null : null, departmentName: name });
  }
  for (const emp of employees) {
    const deptId = emp.departmentId || null;
    out.set(emp.id, { departmentId: deptId, departmentName: deptId ? nameByDeptId.get(deptId) ?? null : null });
  }
  return out;
}

/** Remove a run's register rows (failed run / before a rebuild). */
export async function clearRunRegister(tx: Tx, tenantId: string, runId: string): Promise<void> {
  await tx.execute(sql`DELETE FROM payroll.payroll_register WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid`);
}

/**
 * Rebuild one run's register rows from its slips, inside the caller's
 * transaction (the same one that wrote the slips). Delete-then-insert under a
 * per-run advisory lock, so reruns and concurrent rebuilds are idempotent.
 */
export async function rebuildRunRegister(
  tx: Tx,
  run: { tenantId: string; runId: string; period: string },
  departments: Map<string, RegisterDepartment>,
): Promise<RegisterRow[]> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll_register:${run.tenantId}:${run.runId}`}, 0))`);
  const slips = await repo.listSlipsByRunTx(tx, run.runId, run.tenantId);
  const rows = aggregateRegister(slips, departments);
  await clearRunRegister(tx, run.tenantId, run.runId);
  for (const r of rows) {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_register
        (tenant_id, run_id, department_id, department_name, employee_count,
         total_gross_minor, total_deductions_minor, total_net_minor,
         total_pf_minor, total_esi_minor, total_tds_minor, total_pt_minor,
         total_gpf_minor, total_nps_minor, period)
      VALUES (${run.tenantId}::uuid, ${run.runId}::uuid, ${r.departmentId}::uuid, ${r.departmentName}, ${r.employeeCount},
              ${r.totalGrossMinor.toString()}::bigint, ${r.totalDeductionsMinor.toString()}::bigint, ${r.totalNetMinor.toString()}::bigint,
              ${r.totalPfMinor.toString()}::bigint, ${r.totalEsiMinor.toString()}::bigint, ${r.totalTdsMinor.toString()}::bigint,
              ${r.totalPtMinor.toString()}::bigint,
              ${r.totalGpfMinor.toString()}::bigint, ${r.totalNpsMinor.toString()}::bigint, ${run.period})
    `);
  }
  return rows;
}
