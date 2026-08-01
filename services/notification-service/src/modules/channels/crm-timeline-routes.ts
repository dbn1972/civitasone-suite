/**
 * CH-06: Delivery Events → CRM Timeline Consumer
 *
 * POST /v1/notification/channels/crm-timeline
 * Accepts a delivery event payload, publishes notification.delivery.to_crm command → 202.
 * Bridges delivery tracking into CRM activity creation.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const ALLOWED_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin"];

const deliveryEventBody = z.object({
  deliveryId: z.string().uuid(),
  channel: z.enum(["email", "sms", "push", "webhook"]),
  status: z.enum(["delivered", "opened", "clicked", "bounced", "failed"]),
  recipient: z.string().min(1),
  contactId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().datetime().optional(),
});

export type DeliveryEventBody = z.infer<typeof deliveryEventBody>;

export async function crmTimelineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/channels/crm-timeline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const body = deliveryEventBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.deliveryToCrm, {
      messageId: id,
      type: COMMANDS.deliveryToCrm,
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
