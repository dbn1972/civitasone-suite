/**
 * Project Delay Forecast route for project-service.
 *
 * Route:
 *   GET /v1/projects/:projectId/delay-forecast
 *
 * Calls ml-service internally to run Monte Carlo simulation (1000 iterations).
 * Falls back to baseline schedule dates when < 5 completed tasks exist.
 * Emits `ml.prediction.task_high_risk` event when task risk > 0.80.
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

    // Load project tasks (in production these come from DB)
    const tasks = getProjectTasks(projectId, ctx.tenantId);

    // Check if we have enough completed tasks for ML prediction
    if (!hasEnoughHistory(tasks)) {
      const fallbackResult = computeFallbackForecast(tasks);
      return reply.send({ data: fallbackResult });
    }

    // Attempt ML prediction via ml-service
    let result: DelayForecastResult;

    try {
      const mlResponse = await predictDelay(ctx.tenantId, projectId, {
        completedTaskCount: tasks.filter((t) => t.isCompleted).length,
        totalTaskCount: tasks.length,
      });

      if (mlResponse && !mlResponse.fallback) {
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
        // ML returned fallback — compute locally
        result = computeLocalForecast(tasks);
      }
    } catch (err) {
      // On any error (circuit breaker open, timeout, etc.) — compute locally
      req.log.warn(
        { err: (err as Error).message, projectId },
        "ml-service unavailable for delay forecast, computing locally",
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

// ── Data Access Stubs ─────────────────────────────────────────────
// In production, these query the project database. Stubbed for testability.

/**
 * Get project tasks for delay forecasting.
 * In production, queries project DB for task data including SPI metrics.
 */
function getProjectTasks(_projectId: string, _tenantId: string): TaskData[] {
  // Default stub: returns tasks with enough data for ML
  // In production, this queries the scheduling module's task table
  return [
    { taskId: "task-1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-1", isCriticalPath: true, spiHistory: [1.0, 0.95, 0.9], resourceUtilization: 0.6, isCompleted: true, baselineEndDate: new Date(Date.now() + 86400000 * 5).toISOString() },
    { taskId: "task-2", baselineDurationMs: 172800000, varianceMs: 28800000, dependencies: ["task-1"], assignedTo: "user-1", isCriticalPath: true, spiHistory: [0.9, 0.85, 0.8], resourceUtilization: 0.7, isCompleted: true, baselineEndDate: new Date(Date.now() + 86400000 * 10).toISOString() },
    { taskId: "task-3", baselineDurationMs: 86400000, varianceMs: 21600000, dependencies: ["task-1"], assignedTo: "user-2", isCriticalPath: false, spiHistory: [1.1, 1.0, 0.95], resourceUtilization: 0.5, isCompleted: true, baselineEndDate: new Date(Date.now() + 86400000 * 8).toISOString() },
    { taskId: "task-4", baselineDurationMs: 259200000, varianceMs: 43200000, dependencies: ["task-2", "task-3"], assignedTo: "user-1", isCriticalPath: true, spiHistory: [0.8, 0.75, 0.7], resourceUtilization: 0.85, isCompleted: true, baselineEndDate: new Date(Date.now() + 86400000 * 20).toISOString() },
    { taskId: "task-5", baselineDurationMs: 172800000, varianceMs: 36000000, dependencies: ["task-4"], assignedTo: "user-2", isCriticalPath: true, spiHistory: [0.7, 0.65, 0.6], resourceUtilization: 0.9, isCompleted: true, baselineEndDate: new Date(Date.now() + 86400000 * 30).toISOString() },
    { taskId: "task-6", baselineDurationMs: 345600000, varianceMs: 57600000, dependencies: ["task-5"], assignedTo: "user-1", isCriticalPath: true, spiHistory: [0.6, 0.55, 0.5], resourceUtilization: 0.95, isCompleted: false, baselineEndDate: new Date(Date.now() + 86400000 * 45).toISOString() },
    { taskId: "task-7", baselineDurationMs: 172800000, varianceMs: 28800000, dependencies: ["task-5"], assignedTo: "user-3", isCriticalPath: false, spiHistory: [1.0, 0.95, 0.9], resourceUtilization: 0.4, isCompleted: false, baselineEndDate: new Date(Date.now() + 86400000 * 35).toISOString() },
  ];
}
