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
 * Requirements: 10.5, 10.6
 */

import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { EVENTS } from "../../topics.js";
import { predictDelay } from "./adapter.js";
import {
  computeTaskRiskScores,
  getHighRiskTasks,
  type TaskData,
} from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "project-delay-forecast-consumer" });
const TASK_HIGH_RISK_EVENT = "ml.prediction.task_high_risk";

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
      const isNew = await db.transaction(async (tx) => markProcessed(tx, msg.messageId));
      if (!isNew) return;

      const { taskId, projectId, tenantId } = msg.payload;
      const startMs = Date.now();

      try {
        // Attempt ML prediction for the project
        const mlResponse = await predictDelay(
          tenantId,
          projectId,
          { taskId, trigger: "task_updated" } as unknown as Record<string, number | string>,
        );

        let highRiskTasks: Array<{ taskId: string; riskScore: number; factors: string[] }> = [];

        if (mlResponse && !mlResponse.fallback) {
          // Use ML response to check for high-risk tasks
          highRiskTasks = mlResponse.taskRisks.filter((t) => t.riskScore > 0.80);
        } else {
          // Fallback: compute risk scores locally with stub data
          // In production, this would query the task table
          log.info(
            { tenantId, projectId, taskId, processingTimeMs: Date.now() - startMs },
            "ML unavailable for task update; skipping risk re-evaluation",
          );
          return;
        }

        // Emit high-risk events
        for (const task of highRiskTasks) {
          await queue.publish(TASK_HIGH_RISK_EVENT, {
            messageId: randomUUID(),
            type: TASK_HIGH_RISK_EVENT,
            tenantId,
            actorId: "system",
            correlationId: msg.correlationId,
            schemaVersion: "1.0",
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

        await db.transaction(async (tx) => {
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "project-service", action: "forecast", resourceType: "delay_forecast", resourceId: taskId, outcome: "success" } });
        });
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
