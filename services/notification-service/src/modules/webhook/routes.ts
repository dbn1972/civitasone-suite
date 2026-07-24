import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateEndpointUrl } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin", "notification_admin"];

const createEndpointBody = z.object({
  name: z.string().min(1).max(128),
  url: z.string().url(),
  secret: z.string().min(16).max(256),
});

const updateEndpointBody = z.object({
  name: z.string().min(1).max(128).optional(),
  url: z.string().url().optional(),
  secret: z.string().min(16).max(256).optional(),
  enabled: z.boolean().optional(),
});

const endpointIdParam = z.object({ id: z.string().uuid() });

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Create a webhook endpoint
  app.post("/v1/webhooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createEndpointBody.parse(req.body);

    if (!validateEndpointUrl(body.url)) {
      throw new HttpError(400, "INVALID_URL", "Webhook endpoint URL must use HTTPS");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createWebhookEndpoint(ctx, body));
  });

  // List webhook endpoints
  app.get("/v1/webhooks", async (req, reply) => {
    const ctx = resolveContext(req);
    const endpoints = await repo.listEndpoints(ctx.tenantId);
    return reply.send({ data: endpoints, meta: { total: endpoints.length } });
  });

  // Update a webhook endpoint
  app.patch("/v1/webhooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = endpointIdParam.parse(req.params);
    const body = updateEndpointBody.parse(req.body);

    if (body.url && !validateEndpointUrl(body.url)) {
      throw new HttpError(400, "INVALID_URL", "Webhook endpoint URL must use HTTPS");
    }

    const existing = await repo.findEndpointById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Webhook endpoint not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateWebhookEndpoint(ctx, id, body));
  });

  // Delete (disable) a webhook endpoint
  app.delete("/v1/webhooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = endpointIdParam.parse(req.params);

    const existing = await repo.findEndpointById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Webhook endpoint not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateWebhookEndpoint(ctx, id, { enabled: false }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
