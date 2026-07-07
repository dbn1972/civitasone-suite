/**
 * WBS Hierarchy Rollup & Delay Analysis — routes.
 *
 * Endpoints:
 * - POST /v1/projects/:projectId/wbs/rollup — compute rollup for a project's WBS tree
 * - POST /v1/projects/:projectId/wbs/delay-analysis — compare actuals vs baseline
 *
 * Both endpoints accept task data in the request body (stateless computation)
 * since WBS hierarchy may come from different sources (project tasks, Gantt chart, etc.)
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { rollupWbs, analyzeDelays, MAX_WBS_DEPTH } from "./wbs.js";
import type { WbsNode, DelayAnalysisInput } from "./wbs.js";

const PROJ_ROLES = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

const projectIdParam = z.object({
  projectId: z.string().uuid(),
});

/**
 * Zod schema for WBS rollup request body.
 * Accepts an array of WBS nodes representing the hierarchy.
 */
const wbsRollupBody = z.object({
  nodes: z.array(z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    durationMs: z.coerce.bigint().min(0n),
    costPaise: z.coerce.bigint().min(0n),
    completionPct: z.coerce.number().min(0).max(100),
    weightPct: z.coerce.number().min(0).default(1),
  })).min(1).max(10000),
});

/**
 * Zod schema for delay analysis request body.
 * Accepts an array of tasks with their actual dates and baseline dates.
 */
const delayAnalysisBody = z.object({
  tasks: z.array(z.object({
    taskId: z.string().uuid(),
    actualStartMs: z.coerce.bigint().nullable(),
    actualEndMs: z.coerce.bigint().nullable(),
    baselineStartMs: z.coerce.bigint(),
    baselineEndMs: z.coerce.bigint(),
    onCriticalPath: z.boolean(),
  })).min(1).max(10000),
});

export async function wbsRoutes(app: FastifyInstance): Promise<void> {

  // Local error handler
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")) {
      const zodErr = err as unknown as ZodError;
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: zodErr.issues.map((i: { path: Array<string | number>; message: string }) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });

  /**
   * POST /v1/projects/:projectId/wbs/rollup
   *
   * Computes bottom-up WBS hierarchy rollup:
   * - Duration: sum of child durations
   * - Cost: sum of child costs (bigint paise)
   * - Completion %: weighted average by each child's weightPct
   *
   * Max 10 levels of hierarchy depth.
   */
  app.post("/v1/projects/:projectId/wbs/rollup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    projectIdParam.parse(req.params);
    const body = wbsRollupBody.parse(req.body);

    const nodes: WbsNode[] = body.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      durationMs: n.durationMs,
      costPaise: n.costPaise,
      completionPct: n.completionPct,
      weightPct: n.weightPct,
    }));

    const results = rollupWbs(nodes);

    if (results === null) {
      throw new HttpError(422, "MAX_WBS_DEPTH_EXCEEDED", `WBS hierarchy exceeds maximum ${MAX_WBS_DEPTH} levels`);
    }

    // Serialize bigints to strings for JSON response
    const data = results.map((r) => ({
      id: r.id,
      durationMs: r.durationMs.toString(),
      costPaise: r.costPaise.toString(),
      completionPct: r.completionPct,
      depth: r.depth,
    }));

    return reply.send({ data });
  });

  /**
   * POST /v1/projects/:projectId/wbs/delay-analysis
   *
   * Computes delay analysis by comparing actual/forecast dates vs baseline:
   * - Identifies tasks with positive variance (slipped)
   * - Reports start and end variance in ms
   * - Flags tasks on the critical path
   */
  app.post("/v1/projects/:projectId/wbs/delay-analysis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    projectIdParam.parse(req.params);
    const body = delayAnalysisBody.parse(req.body);

    const inputs: DelayAnalysisInput[] = body.tasks.map((t) => ({
      taskId: t.taskId,
      actualStartMs: t.actualStartMs,
      actualEndMs: t.actualEndMs,
      baselineStartMs: t.baselineStartMs,
      baselineEndMs: t.baselineEndMs,
      onCriticalPath: t.onCriticalPath,
    }));

    const results = analyzeDelays(inputs);

    // Serialize bigints to strings for JSON response
    const data = results.map((r) => ({
      taskId: r.taskId,
      startVarianceMs: r.startVarianceMs.toString(),
      endVarianceMs: r.endVarianceMs.toString(),
      onCriticalPath: r.onCriticalPath,
    }));

    return reply.send({ data });
  });
}
