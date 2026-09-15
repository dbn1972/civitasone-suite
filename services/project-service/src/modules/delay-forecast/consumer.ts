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

      try {
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
        // below finally commits.
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
        // redelivery safely retries the whole thing from scratch.
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
      } catch (err) {
        log.warn(
          { err: (err as Error).message, tenantId, projectId, taskId, processingTimeMs: Date.now() - startMs },
          "delay forecast scoring failed for task update",
        );
        // Non-fatal — do not throw (message is consumed, not retried for ML failures)
      }
    },
  );
}
