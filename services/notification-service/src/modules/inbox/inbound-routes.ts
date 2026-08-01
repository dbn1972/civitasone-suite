/**
 * CH-07: Inbound Messages → CRM Lead Creation
 *
 * POST /v1/notification/inbox/inbound
 * Accepts { channel, from, body, metadata } → identity match or create lead.
 * Publishes notification.inbox.inbound_received → 202.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const ALLOWED_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin", "crm_admin"];

const inboundMessageBody = z.object({
  channel: z.enum(["email", "sms", "whatsapp", "web_chat", "social"]),
  from: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InboundMessageBody = z.infer<typeof inboundMessageBody>;

export async function inboundRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/inbox/inbound", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const body = inboundMessageBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.inboundReceived, {
      messageId: id,
      type: COMMANDS.inboundReceived,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (err && typeof err === "object" && "issues" in err && (err as { name?: string }).name === "ZodError")) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
