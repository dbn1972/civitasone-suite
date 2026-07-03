import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerHookBody, idParam, hooksListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["plugin_admin", "super_admin"];

export async function hooksRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/plugins/hooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = registerHookBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.hookRegister(ctx, body));
  });

  app.get("/v1/plugins/hooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, hooksListSchema, await repo.listByTenant(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/plugins/hooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "hook not found");
    return reply.send(row);
  });

  app.delete("/v1/plugins/hooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.hookDeregister(ctx, id));
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
