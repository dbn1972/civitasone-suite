/**
 * CH-09: Convert Conversation to Ticket
 *
 * POST /v1/notification/inbox/:conversationId/convert-to-ticket
 * Body: { subject, priority?, category? }
 * Publishes notification.inbox.convert_to_ticket → 202.
 * Preserves conversation history as the ticket description.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const ALLOWED_ROLES = ["notification_admin", "super_admin", "tenant_admin", "helpdesk_admin", "helpdesk_user"];

const convertBody = z.object({
  subject: z.string().min(1).max(500),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  category: z.string().max(200).optional(),
});

const conversationIdParam = z.object({
  conversationId: z.string().uuid(),
});

export type ConvertBody = z.infer<typeof convertBody>;

export async function convertRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/inbox/:conversationId/convert-to-ticket", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    const body = convertBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.convertToTicket, {
      messageId: id,
      type: COMMANDS.convertToTicket,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: ctx.tenantId,
        conversationId,
        subject: body.subject,
        priority: body.priority,
        category: body.category,
      },
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
