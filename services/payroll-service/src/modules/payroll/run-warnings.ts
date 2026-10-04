/**
 * Payroll run warnings: persisted non-blocking notices of a run (migration 0087).
 * Written by the run consumer inside the run's own transaction; read by
 * GET /v1/payroll/runs/:id/warnings and counted for the runs list. Every
 * function takes the caller's `tx` so FORCE RLS sees the tenant GUC.
 */
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";

type Tx = typeof db;

/** Employees kept per warning (the full count is stored separately). */
export const RUN_WARNING_SAMPLE_CAP = 50;

export type RunWarningInput = {
  code: string;
  count: number;
  sample: ReadonlyArray<{ employeeId: string; employeeNo: string }>;
};

export type RunWarning = {
  code: string;
  count: number;
  sample: Array<{ employeeId: string; employeeNo: string }>;
  createdAt: string;
};

/** Replace the run's warnings with `warnings` (a run pass rebuilds them whole). */
export async function replaceRunWarnings(tx: Tx, tenantId: string, runId: string, warnings: readonly RunWarningInput[]): Promise<void> {
  await tx.execute(sql`DELETE FROM payroll.payroll_run_warnings WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid`);
  for (const w of warnings) {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_run_warnings (tenant_id, run_id, code, count, sample)
      VALUES (${tenantId}::uuid, ${runId}::uuid, ${w.code}, ${w.count}, ${JSON.stringify(w.sample.slice(0, RUN_WARNING_SAMPLE_CAP))}::jsonb)`);
  }
}

export async function listRunWarnings(tx: Tx, tenantId: string, runId: string): Promise<RunWarning[]> {
  const rows = (await tx.execute(sql`
    SELECT code, count, sample, created_at FROM payroll.payroll_run_warnings
     WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid
     ORDER BY code`)) as unknown as Array<{ code: string; count: number; sample: RunWarning["sample"]; created_at: string | Date }>;
  return rows.map((r) => ({ code: r.code, count: Number(r.count), sample: r.sample ?? [], createdAt: new Date(r.created_at).toISOString() }));
}

/** Number of warnings per run id (runs without any are absent). */
export async function countWarningsByRun(tx: Tx, tenantId: string, runIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (runIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT run_id::text AS run_id, COUNT(*)::int AS n FROM payroll.payroll_run_warnings
     WHERE tenant_id = ${tenantId}::uuid
       AND run_id = ANY(${sql`ARRAY[${sql.join(runIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
     GROUP BY run_id`)) as unknown as Array<{ run_id: string; n: number }>;
  for (const r of rows) out.set(r.run_id, Number(r.n));
  return out;
}
