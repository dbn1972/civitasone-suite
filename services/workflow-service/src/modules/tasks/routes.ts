import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, taskViewSchema } from "./validators.js";
import { paginatedSchema } from "@civitasone/schemas/common";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const tasksListSchema = paginatedSchema(taskViewSchema);

const ROLES = ["workflow_user", "workflow_admin", "super_admin"];

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workflow/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, tasksListSchema, await queries.listTasks(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/workflow/tasks/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeTask(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
