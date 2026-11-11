import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { replyIfRateLimited } from "../../shared/rate-limit-error.js";
import * as commands from "./commands.js";
import { canViewInstance, findById as findTaskById, TASK_ADMIN_ROLES } from "../tasks/repo.js";
import type { TaskForwardRow } from "./schema.js";

export const FORWARD_ROLES = [
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

/**
 * UAT J14 follow-up (security): who may read a task forward chain. Same participant gate as the
 * per-instance reads of #2445 (canViewInstance: the requester, or the holder / assignee /
 * completer of one of its tasks; super_admin / workflow_admin exempt), plus the parties of the
 * chain itself (a forwarder who no longer holds the task can still see where it went).
 */
async function canViewTaskForwards(
  ctx: { tenantId: string; roles: string[]; actorId: string },
  taskId: string,
  forwards: readonly TaskForwardRow[],
): Promise<boolean> {
  if (ctx.roles.some((r) => TASK_ADMIN_ROLES.includes(r))) return true;
  const task = await findTaskById(taskId, ctx.tenantId);
  if (!task) return false;
  if (forwards.some((f) => f.fromUser === ctx.actorId || f.toUser === ctx.actorId)) return true;
  return canViewInstance(ctx.tenantId, task.instanceId, ctx.roles, ctx.actorId);
}

export async function forwardingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/tasks/:id/forward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FORWARD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = forwardBody.parse(req.body ?? {});
    const result = await commands.forwardTask(ctx, id, body.toUserId, body.remarks);
    return reply.code(202).send(result);
  });

  app.post("/v1/workflow/tasks/:id/recall", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FORWARD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recallBody.parse(req.body ?? {});
    const result = await commands.recallTask(ctx, id, body.remarks);
    return reply.code(202).send(result);
  });

  app.get("/v1/workflow/tasks/:id/forwards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FORWARD_ROLES);
    const { id } = idParam.parse(req.params);
    const forwards = await commands.listForwards(id, ctx.tenantId);
    // A non-participant gets the same 404 as for a task that does not exist.
    if (!(await canViewTaskForwards(ctx, id, forwards))) throw new HttpError(404, "NOT_FOUND", "task not found");
    return reply.send({ data: forwards });
  });

  app.setErrorHandler((err, req, reply) => {
    const rateLimited = replyIfRateLimited(err, req, reply);
    if (rateLimited) return rateLimited;
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
