import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { createTenantBody, editionChangeBody, suspendBody, idParam, listQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/tenants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = createTenantBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTenant(ctx, body));
  });

  app.get("/v1/admin/tenants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { page, limit } = listQuery.parse(req.query);
    return reply.send(await queries.listTenants(page, limit));
  });

  app.get("/v1/admin/tenants/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const view = await queries.getTenant(id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "tenant not found");
    return reply.send(view);
  });

  app.patch("/v1/admin/tenants/:id/edition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = editionChangeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.changeEdition(ctx, id, body));
  });

  app.patch("/v1/admin/tenants/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = suspendBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.suspendTenant(ctx, id, body));
  });

  app.patch("/v1/admin/tenants/:id/reactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reactivateTenant(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
