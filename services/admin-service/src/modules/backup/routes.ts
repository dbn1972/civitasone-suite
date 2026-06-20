import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { tenantIdParam, scheduleBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/tenants/:id/backup/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantIdParam.parse(req.params);
    const body = scheduleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.scheduleBackup(ctx, id, body.cronExpr));
  });

  app.post("/v1/admin/tenants/:id/backup/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.triggerBackup(ctx, id));
  });

  app.get("/v1/admin/tenants/:id/backup/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantIdParam.parse(req.params);
    return reply.send(await queries.getBackupRuns(id));
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
