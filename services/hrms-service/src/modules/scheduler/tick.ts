/**
 * Scheduler tick — periodic worker job that materialises HR due-lists.
 *
 * Tenant-aware: it discovers every tenant that has employees and produces a
 * superannuation due-list and a probation due-list for each.
 *
 * Idempotent: the (tenant, list_kind, run_date, employee) unique constraint plus
 * ON CONFLICT DO UPDATE means re-running the tick on the same day refreshes the
 * snapshot in place rather than duplicating rows. The per-(job, run_date) run
 * marker likewise upserts.
 *
 * The worker invokes `runSchedulerOnce` on an interval (and once on boot). A
 * `runDate`/`asOf` override exists purely so the logic can be driven
 * deterministically for verification.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../../shared/db.js";
import {
  computeSuperannuationDue, computeProbationDue,
  type SuperannuationCandidate, type ProbationCandidate, type DueRow,
} from "./engine.js";

export interface TickOptions {
  /** ISO date used as "today" for due-window math. Defaults to current UTC date. */
  asOf?: string;
  /** Window (days) for the superannuation due-list. Default 180. */
  superannuationWithinDays?: number;
  /** Window (days) for the probation due-list. Default 60. */
  probationWithinDays?: number;
  /** Superannuation age. Default 60. */
  superannuationAge?: number;
  /** Probation length in months when no confirmation date recorded. Default 24. */
  probationMonths?: number;
}

export interface TickResult {
  runDate: string;
  tenantsSeen: number;
  superannuationRows: number;
  probationRows: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function listTenantIds(db: Db): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT DISTINCT tenant_id FROM employee.hrms_employees`);
  // drizzle postgres-js returns an array-like of rows
  return (rows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
}

interface EmpRow {
  id: string;
  employee_no: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  status: string;
  date_of_joining: string;
  confirmation_date: string | null;
}

async function listEmployees(db: Db, tenantId: string): Promise<EmpRow[]> {
  const rows = await db.execute(sql`
    SELECT id, employee_no, full_name, date_of_birth::text AS date_of_birth,
           status, date_of_joining::text AS date_of_joining,
           confirmation_date::text AS confirmation_date
    FROM employee.hrms_employees
    WHERE tenant_id = ${tenantId} AND status <> 'separated'`);
  return rows as unknown as EmpRow[];
}

async function upsertDueRows(
  db: Db, tenantId: string, listKind: string, runDate: string, rows: readonly DueRow[],
): Promise<void> {
  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO scheduler.hrms_due_list
        (tenant_id, list_kind, run_date, employee_id, employee_no, full_name,
         due_date, days_remaining, details)
      VALUES
        (${tenantId}, ${listKind}, ${runDate}, ${r.employeeId}, ${r.employeeNo},
         ${r.fullName}, ${r.dueDateISO}, ${r.daysRemaining}, ${JSON.stringify(r.details)}::jsonb)
      ON CONFLICT (tenant_id, list_kind, run_date, employee_id) DO UPDATE
        SET employee_no = EXCLUDED.employee_no,
            full_name   = EXCLUDED.full_name,
            due_date    = EXCLUDED.due_date,
            days_remaining = EXCLUDED.days_remaining,
            details     = EXCLUDED.details,
            created_at  = now()`);
  }
}

export const SCHEDULER_JOB_NAME = "hr_due_lists";

export async function runSchedulerOnce(db: Db, opts: TickOptions = {}): Promise<TickResult> {
  const runDate = opts.asOf ?? todayISO();
  const supWindow = opts.superannuationWithinDays ?? 180;
  const probWindow = opts.probationWithinDays ?? 60;
  const supAge = opts.superannuationAge ?? 60;
  const probMonths = opts.probationMonths ?? 24;

  // open the run marker (idempotent per job+run_date)
  await db.execute(sql`
    INSERT INTO scheduler.hrms_scheduler_runs (job_name, run_date, status)
    VALUES (${SCHEDULER_JOB_NAME}, ${runDate}, 'running')
    ON CONFLICT (job_name, run_date) DO UPDATE
      SET started_at = now(), status = 'running', finished_at = NULL`);

  let tenantsSeen = 0;
  let supRows = 0;
  let probRows = 0;

  try {
    const tenants = await listTenantIds(db);
    for (const tenantId of tenants) {
      tenantsSeen += 1;
      const emps = await listEmployees(db, tenantId);

      const supCandidates: SuperannuationCandidate[] = emps
        .filter((e) => e.date_of_birth)
        .map((e) => ({
          employeeId: e.id, employeeNo: e.employee_no, fullName: e.full_name,
          dateOfBirthISO: e.date_of_birth as string,
        }));
      const supDue = computeSuperannuationDue(supCandidates, runDate, supWindow, supAge);
      await upsertDueRows(db, tenantId, "superannuation", runDate, supDue);
      supRows += supDue.length;

      const probCandidates: ProbationCandidate[] = emps.map((e) => ({
        employeeId: e.id, employeeNo: e.employee_no, fullName: e.full_name,
        status: e.status, dateOfJoiningISO: e.date_of_joining,
        confirmationDateISO: e.confirmation_date,
      }));
      const probDue = computeProbationDue(probCandidates, runDate, probWindow, probMonths);
      await upsertDueRows(db, tenantId, "probation", runDate, probDue);
      probRows += probDue.length;
    }

    await db.execute(sql`
      UPDATE scheduler.hrms_scheduler_runs
      SET finished_at = now(), status = 'ok',
          tenants_seen = ${tenantsSeen}, rows_produced = ${supRows + probRows},
          detail = ${`superannuation=${supRows}, probation=${probRows}`}
      WHERE job_name = ${SCHEDULER_JOB_NAME} AND run_date = ${runDate}`);
  } catch (err) {
    await db.execute(sql`
      UPDATE scheduler.hrms_scheduler_runs
      SET finished_at = now(), status = 'error', detail = ${String(err)}
      WHERE job_name = ${SCHEDULER_JOB_NAME} AND run_date = ${runDate}`);
    throw err;
  }

  return { runDate, tenantsSeen, superannuationRows: supRows, probationRows: probRows };
}
