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
 *
 * FORCE-RLS fix (cross-tenant discovery): tenant discovery and the per-tenant
 * read/write below used to run as bare `db.execute()` calls on the pooled
 * `db` singleton, with no `app.tenant_id` GUC ever set. Under the
 * NOBYPASSRLS `hrms_svc` role, employee.hrms_employees' and
 * scheduler.hrms_due_list's fail-closed FORCE RLS policies (migration
 * 0026/0034) silently returned/affected zero rows on every tick, for every
 * tenant — this tick has been finding nothing since the day RLS was turned
 * on. Confirmed independently by this exact codebase's own migration 0144
 * header comment ("this is also why scheduler/tick.ts's own listTenantIds()
 * cross-tenant query currently returns zero tenants in this environment —
 * ... a separate, pre-existing regression") and by lifecycle/
 * effective-scheduler.ts's header comment (same observation, for the
 * sibling lifecycle scheduler).
 *
 * Fix pattern: migration 0144 originally tried to solve "no single tenant
 * context to scope a find-every-due-row query to" with two SECURITY DEFINER
 * SQL functions owned by civitas_admin. That approach does NOT work in this
 * fleet and must not be repeated here: civitas_admin is deliberately
 * NOSUPERUSER NOBYPASSRLS (infra/db/bootstrap/bootstrap_admin_role.sql) —
 * SECURITY DEFINER only elevates a call to its OWNER's privileges, and no
 * owner in this fleet has BYPASSRLS to elevate to, so those functions never
 * actually bypassed anything and silently returned zero rows regardless of
 * SECURITY DEFINER (reproduced live per migration 0144's own follow-up,
 * migration 0146, which drops them). This tick uses the pattern migration
 * 0146 established instead — the SAME pattern, not a different one, per
 * this codebase's own corrected history for exactly this problem class:
 * discover the tenant universe via employee.hrms_employees (which migration
 * 0133 already gave a `app.platform_bypass`-gated permissive SELECT policy)
 * through shared/db.ts's `scopedPlatformRead`, then re-enter EACH tenant's
 * own strict RLS context via `runWithTenant` before reading/writing that
 * tenant's rows — ordinary, fully RLS-enforced queries, no bypass on
 * employee.hrms_employees (beyond the id/tenant-id-only discovery step) or
 * scheduler.hrms_due_list at all. Mirrors lifecycle/effective-scheduler.ts
 * exactly (the sibling scheduler already fixed this way).
 *
 * scheduler.hrms_scheduler_runs (the run-marker table below) carries no
 * tenant_id and has RLS disabled entirely (see effective-scheduler.ts's own
 * note), so its bare `db.execute()` calls are correct as-is and are not
 * part of this fix.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { recordScheduledJobRun } from "@civitasone/observability";
import { runWithTenant } from "@civitasone/db";
import type { Db, ScopedTx } from "../../shared/db.js";
import { scopedPlatformRead } from "../../shared/db.js";
import * as employeeRepo from "../employee/repo.js";
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

export interface TenantOutcome {
  tenantId: string;
  ok: boolean;
  superannuationRows: number;
  probationRows: number;
  error?: string;
}

export interface TickResult {
  runDate: string;
  tenantsSeen: number;
  superannuationRows: number;
  probationRows: number;
  tenantsFailed: number;
  outcomes: TenantOutcome[];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

async function listEmployees(tx: ScopedTx, tenantId: string): Promise<EmpRow[]> {
  const rows = await tx.execute(sql`
    SELECT id, employee_no, full_name, date_of_birth::text AS date_of_birth,
           status, date_of_joining::text AS date_of_joining,
           confirmation_date::text AS confirmation_date
    FROM employee.hrms_employees
    WHERE tenant_id = ${tenantId} AND status <> 'separated'`);
  return rows as unknown as EmpRow[];
}

async function upsertDueRows(
  tx: ScopedTx, tenantId: string, listKind: string, runDate: string, rows: readonly DueRow[],
): Promise<void> {
  if (rows.length === 0) return;
  // M5: batch all rows into a single multi-row INSERT ... ON CONFLICT instead of
  // one round-trip per row. Idempotent re-runs still refresh in place.
  const values = sql.join(
    rows.map((r) => sql`(${tenantId}, ${listKind}, ${runDate}, ${r.employeeId}, ${r.employeeNo}, ${r.fullName}, ${r.dueDateISO}, ${r.daysRemaining}, ${JSON.stringify(r.details)}::jsonb)`),
    sql`, `,
  );
  await tx.execute(sql`
    INSERT INTO scheduler.hrms_due_list
      (tenant_id, list_kind, run_date, employee_id, employee_no, full_name,
       due_date, days_remaining, details)
    VALUES ${values}
    ON CONFLICT (tenant_id, list_kind, run_date, employee_id) DO UPDATE
      SET employee_no = EXCLUDED.employee_no,
          full_name   = EXCLUDED.full_name,
          due_date    = EXCLUDED.due_date,
          days_remaining = EXCLUDED.days_remaining,
          details     = EXCLUDED.details,
          created_at  = now()`);
}

export const SCHEDULER_JOB_NAME = "hr_due_lists";

// PERF-011: this tick previously emitted no logs at all — a hung DB call or a
// tenant scan that silently produced zero rows was invisible outside the
// scheduler.hrms_scheduler_runs row (queried on demand, never watched). The
// logger + recordScheduledJobRun() below give it the same "is this stuck"
// signal every other scheduled job in the fleet now has, and reuse
// SCHEDULER_JOB_NAME so the log lines, the Prometheus series, and the
// job_name column in scheduler.hrms_scheduler_runs all correlate.
const log = pino({ name: SCHEDULER_JOB_NAME });

export async function runSchedulerOnce(db: Db, opts: TickOptions = {}): Promise<TickResult> {
  const start = performance.now();
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
  const outcomes: TenantOutcome[] = [];

  try {
    // Cross-tenant discovery: candidate TENANT IDS ONLY, via a scoped
    // platform-bypass read (minimal blast radius — ids, not employee rows).
    // See shared/db.ts's scopedPlatformRead doc comment and this file's
    // header comment above for why a bare db.execute()/db.transaction() (or
    // a SECURITY DEFINER function, migration 0144's original approach) here
    // would silently find zero tenants instead. Reuses employeeRepo's
    // existing tenant-id query (already used the same way by
    // lifecycle/effective-scheduler.ts) rather than duplicating it.
    const tenants = await scopedPlatformRead((tx) => employeeRepo.listEmployeeTenantIds(tx));
    for (const tenantId of tenants) {
      tenantsSeen += 1;
      // M5: isolate each tenant so one bad tenant cannot poison the whole tick.
      try {
        // This tenant's actual employee read AND due-list write run under
        // its own strict-RLS GUC via runWithTenant — ordinary, fully
        // tenant-scoped queries, no bypass involved for
        // employee.hrms_employees/scheduler.hrms_due_list at all.
        const { supDue, probDue } = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
          const emps = await listEmployees(tx, tenantId);

          const supCandidates: SuperannuationCandidate[] = emps
            .filter((e) => e.date_of_birth)
            .map((e) => ({
              employeeId: e.id, employeeNo: e.employee_no, fullName: e.full_name,
              dateOfBirthISO: e.date_of_birth as string,
            }));
          const supDue = computeSuperannuationDue(supCandidates, runDate, supWindow, supAge);
          await upsertDueRows(tx, tenantId, "superannuation", runDate, supDue);

          const probCandidates: ProbationCandidate[] = emps.map((e) => ({
            employeeId: e.id, employeeNo: e.employee_no, fullName: e.full_name,
            status: e.status, dateOfJoiningISO: e.date_of_joining,
            confirmationDateISO: e.confirmation_date,
          }));
          const probDue = computeProbationDue(probCandidates, runDate, probWindow, probMonths);
          await upsertDueRows(tx, tenantId, "probation", runDate, probDue);

          return { supDue, probDue };
        }));

        supRows += supDue.length;
        probRows += probDue.length;
        outcomes.push({
          tenantId, ok: true,
          superannuationRows: supDue.length, probationRows: probDue.length,
        });
      } catch (tenantErr) {
        outcomes.push({
          tenantId, ok: false, superannuationRows: 0, probationRows: 0,
          error: String(tenantErr),
        });
      }
    }

    const failed = outcomes.filter((o) => !o.ok).length;
    // The run-marker status check constraint allows only running/ok/error; a tick
    // that completed (even with some per-tenant failures) is 'ok' here, with the
    // failure count surfaced in `detail` and the structured `outcomes` return.
    await db.execute(sql`
      UPDATE scheduler.hrms_scheduler_runs
      SET finished_at = now(), status = 'ok',
          tenants_seen = ${tenantsSeen}, rows_produced = ${supRows + probRows},
          detail = ${`superannuation=${supRows}, probation=${probRows}, tenantsFailed=${failed}`}
      WHERE job_name = ${SCHEDULER_JOB_NAME} AND run_date = ${runDate}`);

    // PERF-011: record the tick as a success even when some individual
    // tenants failed (matches the run-marker's own 'ok' semantics above) —
    // per-tenant failures are already visible via `failed`/`outcomes`.
    const durationMs = performance.now() - start;
    recordScheduledJobRun(SCHEDULER_JOB_NAME, "success", durationMs);
    log.info(
      {
        event: "scheduler.tick", runDate, tenantsSeen,
        superannuationRows: supRows, probationRows: probRows,
        tenantsFailed: failed, durationMs: Math.round(durationMs),
      },
      "hrms scheduler tick completed",
    );
  } catch (err) {
    // Only reached for tick-wide failures (tenant discovery / run-marker update).
    await db.execute(sql`
      UPDATE scheduler.hrms_scheduler_runs
      SET finished_at = now(), status = 'error', detail = ${String(err)}
      WHERE job_name = ${SCHEDULER_JOB_NAME} AND run_date = ${runDate}`);

    const durationMs = performance.now() - start;
    recordScheduledJobRun(SCHEDULER_JOB_NAME, "failure", durationMs);
    log.error(
      { event: "scheduler.tick", runDate, durationMs: Math.round(durationMs), err },
      "hrms scheduler tick failed",
    );
    throw err;
  }

  return {
    runDate, tenantsSeen,
    superannuationRows: supRows, probationRows: probRows,
    tenantsFailed: outcomes.filter((o) => !o.ok).length,
    outcomes,
  };
}
