import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { tenantIdParam, scheduleBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as tenantsRepo from "../tenants/repo.js";

/** W6 P1: a backup command for a tenant that does not exist is a 404, not a queued no-op. */
async function assertTenantExists(id: string): Promise<void> {
  if (!(await tenantsRepo.findById(id))) throw new HttpError(404, "NOT_FOUND", "tenant not found");
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/tenants/:id/backup/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantIdParam.parse(req.params);
    const body = scheduleBody.parse(req.body);
    await assertTenantExists(id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.scheduleBackup(ctx, id, body.cronExpr));
  });

  app.post("/v1/admin/tenants/:id/backup/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantIdParam.parse(req.params);
    await assertTenantExists(id);
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
