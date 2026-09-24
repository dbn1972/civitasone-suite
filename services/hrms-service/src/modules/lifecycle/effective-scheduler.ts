/**
 * Effective-dating scheduler — periodic worker job that applies promotions
 * and transfers whose effectiveDate has arrived.
 *
 * Bug fix (migration 0144): every write path that can approve a promotion or
 * transfer (direct create, eOffice-approved) now defers a future-dated order
 * instead of applying it to employee.hrms_employees immediately — the order
 * is recorded "pending_effective" instead (see lifecycle/repo.ts's
 * applyPromotionEffect / applyTransferEffect and their callers in
 * consumer.ts, promotion-eoffice-consumer.ts, eoffice-consumer.ts, and
 * employee/consumer.ts). This tick is what actually completes those orders
 * once their date arrives: on every run it finds every "pending_effective"
 * promotion/transfer whose effectiveDate is today or earlier, across all
 * tenants, and applies each in its own transaction.
 *
 * Cross-tenant discovery: hrms_svc (this service's connecting DB role) does
 * NOT have BYPASSRLS by design (packages/db/src/tenant-scope.ts's rollout
 * doc requires this), and hrms_promotions/hrms_transfers' RLS policy is a
 * strict `tenant_id = employee.current_tenant_id()` under FORCE ROW LEVEL
 * SECURITY with no admin/bypass clause — so a plain cross-tenant SELECT from
 * this service always sees zero rows, no matter what (if any) tenant
 * context is active. (Confirmed empirically: this is also why
 * scheduler/tick.ts's own listTenantIds() cross-tenant query currently
 * returns zero tenants in this environment — a separate, pre-existing
 * regression, NOT fixed here.) There is no single tenant context to scope a
 * "find every due row" query to, so discovery goes through
 * lifecycle.due_promotion_ids(date)/due_transfer_ids(date) — two narrow,
 * read-only, SECURITY DEFINER SQL functions added by migration 0144 that
 * return only (id, tenant_id), nothing else. Every actual WRITE below still
 * goes through the normal, fully tenant-scoped, RLS-enforced path: each due
 * row is applied inside `runWithTenant(tenantId, () => db.transaction(...))`
 * — the same combination the queue-service's real consumer wrapping (and
 * this codebase's own test convention, e.g. admin-service's
 * wireTenantAwareQueue) uses, confirmed necessary because the GUC-setting
 * wrapper only intercepts db.transaction(), not plain db.select()/insert().
 *
 * Idempotent: each row is only picked up while status = 'pending_effective';
 * transitionPromotion/transitionTransfer's guarded WHERE means a row already
 * completed by a previous tick (or a concurrent approval landing in between)
 * is simply not re-applied. A row whose apply step fails (e.g. an
 * optimistic-concurrency conflict on the employee row — see
 * updateEmployeeVersioned) stays 'pending_effective' and is retried on the
 * next tick; it never gets silently marked 'completed' without actually
 * landing on the employee master, because the status transition and the
 * apply happen in the SAME transaction.
 *
 * The worker invokes `applyDueEffectiveChangesOnce` on the same interval as
 * runSchedulerOnce (see worker.ts) — default hourly, comfortably inside the
 * "daily" cadence this fix needs. A `runDate`/`asOf` override exists purely
 * so the logic can be driven deterministically for verification.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { recordScheduledJobRun } from "@civitasone/observability";
import { runWithTenant } from "@civitasone/db";
import type { Db } from "../../shared/db.js";
import * as repo from "./repo.js";

export const EFFECTIVE_CHANGES_JOB_NAME = "hrms_lifecycle_effective_changes";

/**
 * System actor id for scheduler-driven writes, matching the convention
 * already used elsewhere in this service for background/system-initiated
 * actions (see recruitment/commands.ts, recruitment/candidate-public-auth-routes.ts).
 */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

const log = pino({ name: EFFECTIVE_CHANGES_JOB_NAME });

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface EffectiveChangesTickOptions {
  /** ISO date used as "today" for the due check. Defaults to current UTC date. */
  asOf?: string;
}

export interface EffectiveChangesResult {
  runDate: string;
  promotionsApplied: number;
  promotionsFailed: number;
  transfersApplied: number;
  transfersFailed: number;
}

interface DueRef {
  id: string;
  tenant_id: string;
}

export async function applyDueEffectiveChangesOnce(
  db: Db, opts: EffectiveChangesTickOptions = {},
): Promise<EffectiveChangesResult> {
  const start = performance.now();
  const runDate = opts.asOf ?? todayISO();

  // Open the run marker (idempotent per job+run_date) — same table and
  // pattern scheduler/tick.ts uses for "hr_due_lists", distinguished by
  // job_name so the two jobs' rows never collide. scheduler.hrms_scheduler_runs
  // itself carries no tenant_id and has RLS disabled entirely, so this needs
  // no tenant context.
  await db.execute(sql`
    INSERT INTO scheduler.hrms_scheduler_runs (job_name, run_date, status)
    VALUES (${EFFECTIVE_CHANGES_JOB_NAME}, ${runDate}, 'running')
    ON CONFLICT (job_name, run_date) DO UPDATE
      SET started_at = now(), status = 'running', finished_at = NULL`);

  let promotionsApplied = 0;
  let promotionsFailed = 0;
  let transfersApplied = 0;
  let transfersFailed = 0;

  try {
    const duePromotions = await db.execute(
      sql`SELECT id, tenant_id FROM lifecycle.due_promotion_ids(${runDate})`,
    ) as unknown as DueRef[];

    for (const promo of duePromotions) {
      try {
        await runWithTenant(promo.tenant_id, () => db.transaction(async (tx) => {
          const completed = await repo.transitionPromotion(promo.tenant_id, promo.id, SYSTEM_ACTOR, {
            from: ["pending_effective"], to: "completed",
          }, tx);
          if (!completed) return; // raced: already applied/moved on since the SELECT above
          // Concurrency guard: basicMinor is also written by the direct
          // promotion route, the eOffice-approved route, the pay-matrix
          // annual increment, and the generic employee-update command — all
          // independent, asynchronous writers of the same field.
          // applyPromotionEffect reads the row's current version fresh,
          // inside this transaction, and uses it as an optimistic-
          // concurrency precondition. See employee/repo.ts
          // updateEmployeeVersioned.
          await repo.applyPromotionEffect(tx, completed, SYSTEM_ACTOR);
        }));
        promotionsApplied += 1;
      } catch (err) {
        promotionsFailed += 1;
        log.error(
          { err, promotionId: promo.id, tenantId: promo.tenant_id },
          "failed to apply a due promotion; left pending_effective for the next tick",
        );
      }
    }

    const dueTransfers = await db.execute(
      sql`SELECT id, tenant_id FROM lifecycle.due_transfer_ids(${runDate})`,
    ) as unknown as DueRef[];

    for (const transfer of dueTransfers) {
      try {
        await runWithTenant(transfer.tenant_id, () => db.transaction(async (tx) => {
          const completed = await repo.transitionTransfer(transfer.tenant_id, transfer.id, SYSTEM_ACTOR, {
            from: ["pending_effective"], to: "completed",
          }, tx);
          if (!completed) return;
          await repo.applyTransferEffect(tx, completed, SYSTEM_ACTOR);
        }));
        transfersApplied += 1;
      } catch (err) {
        transfersFailed += 1;
        log.error(
          { err, transferId: transfer.id, tenantId: transfer.tenant_id },
          "failed to apply a due transfer; left pending_effective for the next tick",
        );
      }
    }

    await db.execute(sql`
      UPDATE scheduler.hrms_scheduler_runs
      SET finished_at = now(), status = 'ok',
          tenants_seen = 0, rows_produced = ${promotionsApplied + transfersApplied},
          detail = ${`promotions=${promotionsApplied} (failed ${promotionsFailed}), transfers=${transfersApplied} (failed ${transfersFailed})`}
      WHERE job_name = ${EFFECTIVE_CHANGES_JOB_NAME} AND run_date = ${runDate}`);

    const durationMs = performance.now() - start;
    recordScheduledJobRun(EFFECTIVE_CHANGES_JOB_NAME, "success", durationMs);
    log.info(
      {
        event: "scheduler.tick", runDate,
        promotionsApplied, promotionsFailed, transfersApplied, transfersFailed,
        durationMs: Math.round(durationMs),
      },
      "hrms lifecycle effective-changes tick completed",
    );

    return { runDate, promotionsApplied, promotionsFailed, transfersApplied, transfersFailed };
  } catch (err) {
    // Only reached for tick-wide failures (the due-row discovery calls
    // themselves, or the run-marker writes) — a per-row apply failure is
    // caught above and does not reach here, matching scheduler/tick.ts's
    // "per-unit failures don't fail the whole tick" convention.
    await db.execute(sql`
      UPDATE scheduler.hrms_scheduler_runs
      SET finished_at = now(), status = 'error', detail = ${String(err)}
      WHERE job_name = ${EFFECTIVE_CHANGES_JOB_NAME} AND run_date = ${runDate}`);

    const durationMs = performance.now() - start;
    recordScheduledJobRun(EFFECTIVE_CHANGES_JOB_NAME, "failure", durationMs);
    log.error(
      { event: "scheduler.tick", runDate, durationMs: Math.round(durationMs), err },
      "hrms lifecycle effective-changes tick failed",
    );
    throw err;
  }
}
