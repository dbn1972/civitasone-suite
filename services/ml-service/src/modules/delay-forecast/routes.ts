/**
 * Delay Forecast Simulation — POST /v1/ml/internal/delay-forecast/simulate
 *
 * Internal, service-to-service endpoint (the same x-internal + x-service-secret
 * + x-tenant-id mechanism documented in packages/auth/src/plugin.ts and already
 * used by e.g. services/payroll-service/src/shared/hrms-client.ts to call
 * hrms-service) that runs the REAL Monte Carlo simulation
 * (../algorithms/monte-carlo.ts's simulateProjectDelay) over a caller-supplied
 * task graph.
 *
 * DOM-017: this module — and the monte-carlo.ts algorithm it wraps — previously
 * had zero callers anywhere in the fleet. project-service's delay-forecast
 * route/consumer called the unrelated generic POST /v1/ml/predict (logistic
 * regression over the "tasks" domain) with just two scalar counts, which could
 * never produce a real forecast (no "tasks" model is ever registered) and with
 * no internal-service auth headers at all (guaranteed 401), so every request
 * silently fell back to a simpler local computation with no error surfaced.
 * This route is the real path project-service now calls — see
 * services/project-service/src/modules/delay-forecast/adapter.ts.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { simulateProjectDelay, type TaskSimInput } from "../algorithms/monte-carlo.js";

const DELAY_FORECAST_ROLES = ["ml_admin", "super_admin"];

const taskSimInputSchema = z.object({
  taskId: z.string().min(1),
  baselineDurationMs: z.number().nonnegative(),
  varianceMs: z.number().nonnegative(),
  dependencies: z.array(z.string()),
  assignedTo: z.string().optional(),
  isCriticalPath: z.boolean(),
});

const simulateRequestSchema = z.object({
  // Correlation only — the simulation is a pure function of `tasks` and never
  // itself reads the DB, but this lets ml-service's logs be joined back to
  // the calling project.
  projectId: z.string().optional(),
  tasks: z.array(taskSimInputSchema).min(1).max(5000),
  iterations: z.number().int().min(1).max(5000).optional(),
  seed: z.number().int().optional(),
});

/** exactOptionalPropertyTypes: zod's `.optional()` yields `T | undefined`,
 * which isn't assignable to TaskSimInput's `assignedTo?: string` unless the
 * key is genuinely omitted when absent — mirrors the same pattern already
 * used in project-service/src/modules/delay-forecast/repo.ts. */
function toSimInput(t: z.infer<typeof taskSimInputSchema>): TaskSimInput {
  return {
    taskId: t.taskId,
    baselineDurationMs: t.baselineDurationMs,
    varianceMs: t.varianceMs,
    dependencies: t.dependencies,
    ...(t.assignedTo !== undefined ? { assignedTo: t.assignedTo } : {}),
    isCriticalPath: t.isCriticalPath,
  };
}

export async function delayForecastRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/ml/internal/delay-forecast/simulate
   *
   * Runs the real Monte Carlo simulation (default 1000 iterations) over the
   * supplied task graph and returns P50/P80/P95 completion offsets (ms from
   * "now"), per-task risk scores, and resource bottlenecks. Internal-service
   * auth only — see packages/auth/src/plugin.ts — not reachable with an
   * ordinary user JWT unless that user also holds one of DELAY_FORECAST_ROLES.
   */
  app.post("/v1/ml/internal/delay-forecast/simulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DELAY_FORECAST_ROLES);

    const body = simulateRequestSchema.parse(req.body);

    const startTime = Date.now();
    const result = simulateProjectDelay(
      body.tasks.map(toSimInput),
      body.iterations ?? 1000,
      body.seed,
    );
    const latencyMs = Date.now() - startTime;

    req.log.info(
      {
        projectId: body.projectId,
        taskCount: body.tasks.length,
        iterations: body.iterations ?? 1000,
        latencyMs,
      },
      "delay-forecast Monte Carlo simulation completed",
    );

    // bigint isn't JSON-serializable — ms-since-epoch-scale durations are
    // far below Number.MAX_SAFE_INTEGER, so converting is lossless here.
    return reply.send({
      data: {
        p50Ms: Number(result.p50Ms),
        p80Ms: Number(result.p80Ms),
        p95Ms: Number(result.p95Ms),
        taskRisks: result.taskRisks,
        bottlenecks: result.bottlenecks,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    req.log.error({ err }, "unhandled error in delay-forecast simulate route");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}
