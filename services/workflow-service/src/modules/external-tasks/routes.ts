/**
 * External Task Pattern — long-running tasks executed by external workers.
 * Workers poll for available tasks, lock them, then complete or fail.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const WORKER_ROLES = ["workflow_admin", "super_admin", "tenant_admin", "workflow_worker"];

export async function externalTaskRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/workflow/external-tasks/fetch-and-lock — workers poll for tasks */
  app.post("/v1/workflow/external-tasks/fetch-and-lock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WORKER_ROLES);
    const body = z.object({
      workerId: z.string().min(1).max(128),
      topics: z.array(z.string().min(1).max(128)).min(1).max(20),
      maxTasks: z.number().int().min(1).max(50).default(10),
      lockDurationMs: z.number().int().min(10000).max(3600000).default(300000), // 10s to 1h, default 5min
    }).parse(req.body);

    const tasks = await repo.fetchAndLock(
      ctx.tenantId,
      body.workerId,
      body.topics,
      body.maxTasks,
      body.lockDurationMs,
    );
    return reply.send({ data: tasks });
  });

  /** POST /v1/workflow/external-tasks/:id/complete — worker reports success */
  app.post("/v1/workflow/external-tasks/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WORKER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      workerId: z.string().min(1).max(128),
      result: z.record(z.unknown()).optional(),
    }).parse(req.body ?? {});

    await repo.completeExternalTask(ctx.tenantId, id, body.workerId, body.result);
    return reply.send({ status: "completed", id });
  });

  /** POST /v1/workflow/external-tasks/:id/fail — worker reports failure */
  app.post("/v1/workflow/external-tasks/:id/fail", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WORKER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      workerId: z.string().min(1).max(128),
      errorMessage: z.string().max(1000).optional(),
      retries: z.number().int().min(0).max(10).optional(),
      retryTimeout: z.number().int().min(0).max(3600000).optional(),
    }).parse(req.body ?? {});

    await repo.failExternalTask(ctx.tenantId, id, body.workerId, body.errorMessage, body.retries, body.retryTimeout);
    return reply.send({ status: "failed", id });
  });

  /** POST /v1/workflow/external-tasks/:id/extend-lock — extend lock duration */
  app.post("/v1/workflow/external-tasks/:id/extend-lock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WORKER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      workerId: z.string().min(1).max(128),
      additionalMs: z.number().int().min(10000).max(3600000),
    }).parse(req.body);

    await repo.extendLock(ctx.tenantId, id, body.workerId, body.additionalMs);
    return reply.send({ status: "extended", id });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
