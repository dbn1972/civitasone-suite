/**
 * GAP-PAYROLL-REGISTER-WRITER: one-off backfill of payroll.payroll_register
 * for runs computed before the writer existed. CLI wrapper:
 * src/scripts/backfill-payroll-register.ts (see its header for how to run).
 *
 * Idempotent: by default a run that already has register rows is skipped;
 * with `rebuild` its rows are rebuilt delete-then-insert from its slips --
 * also the repair for rows written as "Unassigned" while HRMS
 * employee-summaries was unavailable.
 * Department attribution uses the employee's CURRENT HRMS department, since
 * slips never recorded one.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";
import { rebuildRunRegister, resolveRegisterDepartments, type RegisterDepartment } from "./register.js";

export type BackfillResult = { runsSeen: number; runsWritten: number; runsSkipped: number; rowsWritten: number };

export async function backfillPayrollRegister(
  tenantId: string,
  opts: { actorId: string; rebuild?: boolean; dryRun?: boolean },
): Promise<BackfillResult> {
  return runWithTenant(tenantId, async () => {
    // Finalised runs only (same status set as repo.ts listRegister); pensioner
    // runs have no departments and are not in the register.
    const runs = (await db.transaction((tx) => tx.execute(sql`
      SELECT r.id::text AS id, r.month,
             EXISTS (SELECT 1 FROM payroll.payroll_register g WHERE g.tenant_id = r.tenant_id AND g.run_id = r.id) AS has_rows
        FROM payroll.payroll_runs r
       WHERE r.tenant_id = ${tenantId}::uuid
         AND r.status IN ('approved', 'disbursed')
         AND r.run_type <> 'pensioner'
       ORDER BY r.month, r.created_at
    `))) as unknown as Array<{ id: string; month: string; has_rows: boolean }>;

    const result: BackfillResult = { runsSeen: runs.length, runsWritten: 0, runsSkipped: 0, rowsWritten: 0 };
    const todo = runs.filter((r) => opts.rebuild || !r.has_rows);
    result.runsSkipped = runs.length - todo.length;
    if (todo.length === 0 || opts.dryRun) return result;

    // One HRMS fetch per tenant: the feed's employee->department mapping does
    // not depend on the month. Fails loudly (no silent all-"Unassigned" rows).
    const input = await fetchPayrollInput(tenantId, todo[0]!.month);
    const departments: Map<string, RegisterDepartment> = await resolveRegisterDepartments(tenantId, input.employees);

    for (const run of todo) {
      const rows = await db.transaction(async (tx) => {
        const written = await rebuildRunRegister(tx as unknown as typeof db, { tenantId, runId: run.id, period: run.month }, departments);
        await enqueue(tx, {
          topic: "audit.event.record", eventType: "audit.event.record",
          tenantId, actorId: opts.actorId, correlationId: randomUUID(),
          payload: { service: "payroll", action: "backfill", resourceType: "payroll_register", resourceId: run.id, outcome: "success" },
        });
        return written;
      });
      result.runsWritten += 1;
      result.rowsWritten += rows.length;
    }
    return result;
  });
}
