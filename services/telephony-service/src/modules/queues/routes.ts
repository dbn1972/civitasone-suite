/** queues HTTP routes. zod-validated; tenant-scoped; RBAC enforced. */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createQueueBody, idParam, queuesListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];
const ADMIN_ROLES = ["telephony_admin", "super_admin"];

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/telephony/queues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, queuesListSchema, await queries.listQueues(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/telephony/queues/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getQueue(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "queue not found");
    return reply.send(row);
  });

  app.post("/v1/telephony/queues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createQueueBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createQueue(ctx, body));
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
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
