import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createInstanceBody, instancesListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as historyRepo from "../history/repo.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin"];

export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createInstanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createInstance(ctx, body));
  });

  app.get("/v1/workflow/instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, instancesListSchema, await queries.listInstances(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/workflow/instances/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await historyRepo.listForInstance(id, ctx.tenantId);
    return reply.send({ data: rows });
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
