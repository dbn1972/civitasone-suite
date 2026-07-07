import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDependencyBody, projectIdParam, dependencyIdParam, listDepsQuery } from "./validators.js";
import { hasCycle, MAX_DEPS_PER_TASK } from "./domain.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { tenantTransaction } from "@civitasone/db";

const PROJ_ROLES = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

export async function schedulingRoutes(app: FastifyInstance): Promise<void> {

  // Local error handler — handles ZodError and HttpError within this scope
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")) {
      const zodErr = err as unknown as ZodError;
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: zodErr.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
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
   * POST /v1/projects/:projectId/dependencies — create a task dependency.
   * Validates: no cycle, max 50 deps per task, lag/lead bounds.
   */
  app.post("/v1/projects/:projectId/dependencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);

    const { projectId } = projectIdParam.parse(req.params);
    const body = createDependencyBody.parse(req.body);

    // Self-dependency check
    if (body.fromTaskId === body.toTaskId) {
      throw new HttpError(422, "SELF_DEPENDENCY", "a task cannot depend on itself");
    }

    // All DB operations within a tenant-scoped transaction (RLS requires GUC)
    const row = await tenantTransaction(db, ctx.tenantId, async (tx) => {
      const txDb = tx as typeof db;

      // Max 50 deps per task check
      const currentCount = await repo.countDepsForTask(txDb, projectId, ctx.tenantId, body.toTaskId);
      if (currentCount >= MAX_DEPS_PER_TASK) {
        throw new HttpError(422, "MAX_DEPS_EXCEEDED", `maximum ${MAX_DEPS_PER_TASK} dependencies per task`);
      }

      // Cycle detection: get existing deps + proposed new dep, run DFS
      const existingDeps = await repo.getProjectDeps(txDb, projectId, ctx.tenantId);
      const proposedDeps = [...existingDeps, { fromTaskId: body.fromTaskId, toTaskId: body.toTaskId }];
      const cyclePath = hasCycle(proposedDeps);

      if (cyclePath) {
        throw new HttpError(422, "CIRCULAR_DEPENDENCY", `circular dependency detected: ${cyclePath.join(" → ")}`);
      }

      // Persist
      const id = randomUUID();
      return repo.insertDependency(txDb, {
        id,
        tenantId: ctx.tenantId,
        projectId,
        fromTaskId: body.fromTaskId,
        toTaskId: body.toTaskId,
        depType: body.depType,
        lagMs: body.lagMs,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    });

    return reply.code(201).send({ data: row });
  });

  /**
   * GET /v1/projects/:projectId/dependencies — list dependencies for project.
   * Reads are safe without tenant transaction (RLS just filters to empty).
   */
  app.get("/v1/projects/:projectId/dependencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { projectId } = projectIdParam.parse(req.params);
    const q = listDepsQuery.parse(req.query);

    const result = await repo.listDependencies(projectId, ctx.tenantId, q.page, q.limit);
    return reply.send(result);
  });

  /**
   * DELETE /v1/projects/:projectId/dependencies/:id — remove a dependency.
   */
  app.delete("/v1/projects/:projectId/dependencies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);

    const { projectId, id } = dependencyIdParam.parse(req.params);

    const deleted = await tenantTransaction(db, ctx.tenantId, async (tx) => {
      return repo.deleteDependency(tx as typeof db, id, projectId, ctx.tenantId);
    });

    if (!deleted) {
      throw new HttpError(404, "NOT_FOUND", "dependency not found");
    }

    return reply.code(204).send();
  });
}
