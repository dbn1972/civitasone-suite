/**
 * Project Delay Forecast route for project-service.
 *
 * Route:
 *   GET /v1/projects/:projectId/delay-forecast
 *
 * Calls ml-service internally to run Monte Carlo simulation (1000 iterations)
 * over the project's REAL tasks (project.project_tasks / task_dependencies —
 * see ./repo.ts). Falls back to baseline schedule dates when < 5 completed
 * tasks exist, and responds 422 when the project has no usable schedule
 * data at all. Emits `ml.prediction.task_high_risk` event when task risk > 0.80.
 *
 * DOM-001: this route used to run the simulation over a hardcoded array of
 * 7 synthetic tasks (task-1..task-7) for EVERY project/tenant, so every
 * project got an identical, fake forecast. Fixed by loading real tasks —
 * see ./repo.ts for how the schema's available columns are mapped honestly
 * onto the simulation's inputs, and the 422 branch below for what happens
 * when a project genuinely has no schedule data to simulate over.
 *
 * DOM-017: even after DOM-001, the "Calls ml-service" claim above wasn't
 * true — predictDelay() called the unrelated generic POST /v1/ml/predict
 * with two scalar counts (no model is ever registered for that "tasks"
 * domain, and the call carried no internal-service auth), so it always
 * failed and this route always computed locally, silently, with only a
 * debug-level log line. adapter.ts now calls ml-service's real Monte Carlo
 * endpoint with the real task list; the catch block below is a genuine
 * fallback for when ml-service is actually unreachable/erroring, not the
 * silent default.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { resolveContext, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { projectIdParam } from "./validators.js";
import { predictDelay } from "./adapter.js";
import { getProjectTasks } from "./repo.js";
import {
  hasEnoughHistory,
  computeFallbackForecast,
  computeTaskRiskScores,
  identifyBottlenecks,
  msToIsoDate,
  getHighRiskTasks,
  HIGH_RISK_THRESHOLD,
  type TaskData,
  type DelayForecastResult,
} from "./domain.js";

const TASK_HIGH_RISK_EVENT = "ml.prediction.task_high_risk";

export async function delayForecastRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/projects/:projectId/delay-forecast
   *
   * Returns Monte Carlo simulation results with P50/P80/P95 dates,
   * per-task risk scores, and resource bottlenecks.
   *
   * Falls back to baseline schedule dates when < 5 completed tasks.
   */
  app.get("/v1/projects/:projectId/delay-forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    const { projectId } = projectIdParam.parse(req.params);

    // Load the project's REAL tasks and dependencies (DOM-001 — this used
    // to be a hardcoded array of 7 synthetic tasks for every project).
    const tasks = await getProjectTasks(projectId, ctx.tenantId);

    // A project with zero tasks, or none with usable planned start/end
    // dates, has no real schedule data to simulate over. Say so honestly
    // instead of quietly falling back to a fabricated "now" estimate.
    const tasksWithScheduleData = tasks.filter((t) => t.baselineDurationMs > 0);
    if (tasksWithScheduleData.length === 0) {
      throw new HttpError(
        422,
        "INSUFFICIENT_DATA",
        `project ${projectId} has no tasks with schedule data (planned start/end dates); cannot compute a delay forecast`,
      );
    }

    // Check if we have enough completed tasks for ML prediction
    if (!hasEnoughHistory(tasks)) {
      const fallbackResult = computeFallbackForecast(tasks);
      return reply.send({ data: fallbackResult });
    }

    // Attempt ML prediction via ml-service
    let result: DelayForecastResult;

    try {
      // Real Monte Carlo simulation over this project's REAL task graph
      // (DOM-017) — null means ML is disabled or there's nothing to
      // simulate; a thrown error means ml-service is unreachable/erroring.
      // Either way we fall back to the local computation below, but only
      // for a genuine reason — never as the silent default.
      const mlResponse = await predictDelay(ctx.tenantId, projectId, tasks);

      if (mlResponse) {
        // Convert ms offsets to ISO dates
        const now = new Date();
        result = {
          p50Date: msToIsoDate(mlResponse.p50Ms, now),
          p80Date: msToIsoDate(mlResponse.p80Ms, now),
          p95Date: msToIsoDate(mlResponse.p95Ms, now),
          taskRisks: mlResponse.taskRisks,
          bottlenecks: mlResponse.bottlenecks,
          isFallback: false,
        };
      } else {
        req.log.info(
          { projectId },
          "ML delay-forecast disabled or no tasks to simulate — computing locally",
        );
        result = computeLocalForecast(tasks);
      }
    } catch (err) {
      // On any error (circuit breaker open, timeout, non-2xx, etc.) —
      // ml-service is genuinely unreachable/failing — compute locally.
      req.log.warn(
        { err: (err as Error).message, projectId },
        "ml-service unavailable for delay forecast (DOM-017 real path failed) — computing locally as fallback",
      );
      result = computeLocalForecast(tasks);
    }

    // Emit high-risk events for tasks with risk score > 0.80
    const highRiskTasks = getHighRiskTasks(result.taskRisks);
    for (const task of highRiskTasks) {
      await queue.publish(TASK_HIGH_RISK_EVENT, {
        messageId: randomUUID(),
        type: TASK_HIGH_RISK_EVENT,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId ?? req.id,
        schemaVersion: "1.0",
        payload: {
          tenantId: ctx.tenantId,
          domain: "tasks",
          entityId: task.taskId,
          prediction: task.riskScore,
          confidence: result.isFallback ? 0 : task.riskScore,
          factors: task.factors.map((f) => ({ feature: f, contribution: 0.33, direction: "negative" as const })),
          timestamp: new Date().toISOString(),
          correlationId: ctx.correlationId ?? req.id,
        },
      });
    }

    return reply.send({ data: result });
  });

  // Error handler for this plugin scope
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request parameters", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    if (err instanceof CircuitBreakerOpenError) {
      return reply.code(503).send({ error: { code: "ML_UNAVAILABLE", message: "prediction service temporarily unavailable", correlationId } });
    }
    req.log.error({ err }, "unhandled error in delay-forecast routes");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}

// ── Local Forecast Computation ────────────────────────────────────

/**
 * Compute delay forecast locally using task risk scores and simple
 * schedule estimation when ML is unavailable but enough history exists.
 */
function computeLocalForecast(tasks: TaskData[]): DelayForecastResult {
  const taskRisks = computeTaskRiskScores(tasks);
  const bottlenecks = identifyBottlenecks(tasks);

  // Estimate completion dates from baseline durations with variance buffers
  const now = new Date();
  const incompleteTasks = tasks.filter((t) => !t.isCompleted);

  // Sum of remaining baseline durations for serial estimation
  let totalBaselineMs = 0;
  let totalVarianceMs = 0;
  for (const task of incompleteTasks) {
    totalBaselineMs += task.baselineDurationMs;
    totalVarianceMs += task.varianceMs;
  }

  // P50 = baseline, P80 = baseline + 0.84σ, P95 = baseline + 1.65σ
  const p50Ms = totalBaselineMs;
  const p80Ms = totalBaselineMs + Math.round(totalVarianceMs * 0.84);
  const p95Ms = totalBaselineMs + Math.round(totalVarianceMs * 1.65);

  return {
    p50Date: msToIsoDate(p50Ms, now),
    p80Date: msToIsoDate(p80Ms, now),
    p95Date: msToIsoDate(p95Ms, now),
    taskRisks,
    bottlenecks,
    isFallback: false,
  };
}
