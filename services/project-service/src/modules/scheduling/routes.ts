import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDependencyBody, projectIdParam, dependencyIdParam, listDepsQuery } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const PROJ_ROLES = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

export async function schedulingRoutes(app: FastifyInstance): Promise<void> {
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

  app.post("/v1/projects/:projectId/dependencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { projectId } = projectIdParam.parse(req.params);
    const body = createDependencyBody.parse(req.body);
    return reply.code(202).send(await commands.createDependency(ctx, projectId, body));
  });

  app.get("/v1/projects/:projectId/dependencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { projectId } = projectIdParam.parse(req.params);
    const q = listDepsQuery.parse(req.query);
    const result = await repo.listDependencies(projectId, ctx.tenantId, q.page, q.limit);
    return reply.send(result);
  });

  app.delete("/v1/projects/:projectId/dependencies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { projectId, id } = dependencyIdParam.parse(req.params);
    await commands.deleteDependency(ctx, projectId, id);
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });
}
