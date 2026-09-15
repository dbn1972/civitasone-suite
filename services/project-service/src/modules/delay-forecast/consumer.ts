/**
 * Delay forecast consumer — reacts to project task updated events.
 *
 * Consumes: project.task.updated
 * When a task is updated (status, assignment, progress, dates), this consumer
 * triggers a delay risk re-evaluation.
 *
 * If any task's risk score exceeds 0.80, emits `ml.prediction.task_high_risk`
 * event for downstream notification/workflow consumers.
 *
 * DOM-017: this consumer used to call predictDelay() with a bogus
 * `{ taskId, trigger: "task_updated" }` payload force-cast to the adapter's
 * features record — never real task data — and on the inevitable failure it
 * just logged and returned, skipping risk re-evaluation entirely (see the
 * removed "Fallback: compute risk scores locally with stub data / In
 * production, this would query the task table" comment — computeTaskRiskScores
 * and getHighRiskTasks were already imported for exactly this, just never
 * wired up). Now loads the project's real tasks and calls the real Monte
 * Carlo endpoint, falling back to computeTaskRiskScores over the real tasks
 * only when ml-service is genuinely unavailable.
 *
 * TX-009: the high-risk events used to be published directly via
 * queue.publish, and markProcessed ran in its own early transaction BEFORE
 * the ml-service call. That left a dual-write hole: a crash (or even just a
 * failed queue.publish call) anywhere after markProcessed's early commit
 * permanently dropped the risk event(s), because a genuine redelivery of the
 * same message would see markProcessed return false and skip re-evaluation
 * entirely. Fixed by moving markProcessed to gate a single transaction,
 * executed AFTER the ml-service call, that also performs the resulting
 * outbox enqueues (per-task high-risk events + the audit row) -- see the
 * comment at that transaction below.
 *
 * review-fix (post-merge-review of this same PR): that transaction was
 * still sitting inside a PRE-EXISTING outer try/catch that predates TX-009
 * and was never touched by it -- written back when this handler's only
 * fallible step was the ml-service call, to degrade gracefully on a genuine
 * ML failure ("non-fatal -- do not throw", so the message still completes
 * instead of retrying forever over a down ml-service). By the time TX-009
 * moved the transaction in, that same catch was ALSO silently swallowing a
 * genuine DB/transaction error at commit time: logged as if it were an ML
 * failure, the handler returned normally, the queue treated the message as
 * fully consumed, and the high-risk events + audit row were lost silently
 * and permanently -- with no redelivery ever triggered. Confirmed via grep
 * that billing-service's near-identical fix (churn/consumer.ts) has NO such
 * wrapping catch around its transaction. Fixed by removing the outer
 * try/catch: the ml-service call already has its OWN try/catch immediately
 * around it (see `predictDelay` below), which already fully implements the
 * original "degrade gracefully on ML failure" behavior on its own, so the
 * outer catch was redundant for that case and only ever added risk. A
 * transaction/DB error below now propagates normally (out of this handler,
 * uncaught) so the queue can redeliver -- exactly matching billing's
 * churn/consumer.ts, the closest structural analog in this codebase.
 *
 * Requirements: 10.5, 10.6
 */

import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { pino } from "pino";
import { EVENTS } from "../../topics.js";
import { predictDelay } from "./adapter.js";
import { getProjectTasks } from "./repo.js";
import {
  computeTaskRiskScores,
  getHighRiskTasks,
  type TaskRiskOutput,
} from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "project-delay-forecast-consumer" });
const TASK_HIGH_RISK_EVENT = "ml.prediction.task_high_risk";

// System-initiated actor for outbox rows with no human actor (this
// consumer's own event, not a re-emission of the inbound message). Mirrors
// the SYSTEM_ACTOR convention used elsewhere in this codebase (e.g.
// workflow-service's nurture-triggers.ts, report-service's scheduled/cron.ts).
// outbox.messages.actor_id is a typed uuid NOT NULL column, so the old
// literal string "system" (which only ever had to satisfy queue.publish's
// untyped envelope) cannot be reused for enqueue().
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

interface TaskUpdatedPayload {
  taskId: string;
  projectId: string;
  tenantId: string;
  status?: string;
  assignedTo?: string;
  updatedFields?: string[];
}

export function registerDelayForecastConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe<TaskUpdatedPayload>(
    EVENTS.taskUpdated,
    async (msg) => {
      const { taskId, projectId, tenantId } = msg.payload;
      const startMs = Date.now();

      // review-fix: NOT wrapped in a try/catch. getProjectTasks and the
      // transaction below are DB operations -- a failure here must propagate
      // so the queue redelivers, exactly like every other consumer in this
      // codebase that doesn't hold a message-level try/catch around its
      // transaction (e.g. billing-service's churn/consumer.ts). Only the
      // ml-service call gets its own try/catch (immediately below), because
      // that specific failure mode is the one this handler intentionally
      // degrades gracefully for.

      // Load the project's REAL tasks — DOM-017: this used to call
      // predictDelay with a bogus {taskId, trigger} payload instead.
      const tasks = await getProjectTasks(projectId, tenantId);
      if (tasks.length === 0) {
        log.info(
          { tenantId, projectId, taskId, processingTimeMs: Date.now() - startMs },
          "project has no tasks; skipping risk re-evaluation",
        );
        return;
      }

      // Real Monte Carlo simulation over the real task graph. A genuine
      // ml-service failure (network/timeout/non-2xx/circuit-breaker-open)
      // falls back to the same local risk computation the delay-forecast
      // route uses — never a silent no-op. Neither predictDelay nor
      // computeTaskRiskScores has any side effects of its own, so it's
      // safe to redo this call on every redelivery until the transaction
      // below finally commits. This try/catch is the ONLY place a genuine
      // ML failure is caught and degraded gracefully -- it does not wrap the
      // transaction below, so a DB/transaction error is never mistaken for
      // an ML failure (review-fix: see the file-level comment above).
      let taskRisks: TaskRiskOutput[];
      try {
        const mlResponse = await predictDelay(tenantId, projectId, tasks);
        taskRisks = mlResponse ? mlResponse.taskRisks : computeTaskRiskScores(tasks);
      } catch (err) {
        log.warn(
          { err: (err as Error).message, tenantId, projectId, taskId, processingTimeMs: Date.now() - startMs },
          "ml-service unavailable for task-update risk re-evaluation — computing locally",
        );
        taskRisks = computeTaskRiskScores(tasks);
      }

      const highRiskTasks = getHighRiskTasks(taskRisks);

      // TX-009: markProcessed + the resulting outbox enqueues (per-task
      // high-risk events + the audit row) now commit ATOMICALLY in ONE
      // transaction, executed AFTER the ml-service call/local fallback
      // above -- never held open across that external I/O (same principle
      // as TX-007: don't hold a DB transaction across slow network calls).
      // "processed" and "the risk events will be delivered" are therefore
      // atomic: either both commit together, or neither does and a real
      // redelivery safely retries the whole thing from scratch. review-fix:
      // this is intentionally OUTSIDE any try/catch -- a thrown DB error
      // propagates out of this handler so the queue redelivers, instead of
      // being swallowed by a catch meant for ML failures (see file-level
      // comment above; matches billing-service's churn/consumer.ts).
      const isNew = await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return false;
        for (const task of highRiskTasks) {
          await enqueue(tx, {
            topic: TASK_HIGH_RISK_EVENT,
            eventType: TASK_HIGH_RISK_EVENT,
            tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: msg.correlationId,
            payload: {
              tenantId,
              domain: "tasks",
              entityId: task.taskId,
              prediction: task.riskScore,
              confidence: task.riskScore,
              factors: task.factors.map((f) => ({ feature: f, contribution: 0.33, direction: "negative" as const })),
              timestamp: new Date().toISOString(),
              correlationId: msg.correlationId,
            },
          });
        }
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "project-service", action: "forecast", resourceType: "delay_forecast", resourceId: taskId, outcome: "success" } });
        return true;
      });
      if (!isNew) return;

      for (const task of highRiskTasks) {
        log.info(
          { tenantId, projectId, taskId: task.taskId, riskScore: task.riskScore, processingTimeMs: Date.now() - startMs },
          "task high risk event emitted",
        );
      }

      if (highRiskTasks.length === 0) {
        log.info(
          { tenantId, projectId, taskId, processingTimeMs: Date.now() - startMs },
          "delay risk assessed — no high-risk tasks",
        );
      }
    },
  );
}
