/**
 * UAT P3 b19 D-16: a payroll run number is unique per tenant
 * (payroll_runs_tenant_id_run_no_key, migration 0001). A run number that is
 * already used is the caller mistake "409 DUPLICATE_RUN_NO", never a 500:
 * the routes pre-check it synchronously, and a racing duplicate that slips
 * past the pre-check (the other row was not committed yet) is recognised from
 * the unique violation itself and mapped to the same outcome.
 */
import { sql } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";

export const DUPLICATE_RUN_NO = "DUPLICATE_RUN_NO";
export const RUN_NO_UNIQUE_CONSTRAINT = "payroll_runs_tenant_id_run_no_key";

export function duplicateRunNoMessage(runNo: string): string {
  return `run number ${runNo} is already used`;
}

export function duplicateRunNoError(runNo: string): HttpError {
  return new HttpError(409, DUPLICATE_RUN_NO, duplicateRunNoMessage(runNo));
}

type PgErrorLike = { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };

/** True when `err` (or the driver error drizzle wraps in `cause`) is the run-number unique violation. */
export function isRunNoUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 4; e = (e as PgErrorLike).cause, depth++) {
    const pe = e as PgErrorLike;
    if (pe.code !== "23505") continue;
    if (pe.constraint_name === RUN_NO_UNIQUE_CONSTRAINT || pe.constraint === RUN_NO_UNIQUE_CONSTRAINT) return true;
    if (typeof pe.message === "string" && pe.message.includes(RUN_NO_UNIQUE_CONSTRAINT)) return true;
  }
  return false;
}

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** Whether the tenant already has a run with this run number (any status: the unique key covers them all). */
export async function runNoTaken(tx: Executor, tenantId: string, runNo: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM payroll.payroll_runs WHERE tenant_id = ${tenantId}::uuid AND run_no = ${runNo} LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}
