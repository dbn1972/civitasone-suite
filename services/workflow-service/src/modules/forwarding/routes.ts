import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";

const ROLES = [
  "workflow_user", "workflow_admin", "super_admin", "hr_admin", "manager",
  "estab_officer", "estab_admin",
];

const idParam = z.object({ id: z.string().uuid() });

const forwardBody = z.object({
  toUserId: z.string().uuid(),
  remarks: z.string().max(512).optional(),
});

const recallBody = z.object({
  remarks: z.string().max(512).optional(),
});

export async function forwardingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/tasks/:id/forward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = forwardBody.parse(req.body ?? {});
    const result = await commands.forwardTask(ctx, id, body.toUserId, body.remarks);
    return reply.code(202).send(result);
  });

  app.post("/v1/workflow/tasks/:id/recall", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = recallBody.parse(req.body ?? {});
    const result = await commands.recallTask(ctx, id, body.remarks);
    return reply.code(202).send(result);
  });

  app.get("/v1/workflow/tasks/:id/forwards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const forwards = await commands.listForwards(id, ctx.tenantId);
    return reply.send({ data: forwards });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        code: err.code,
        message: err.message,
        correlationId,
        retryable: false,
      });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
