import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const HELPDESK_ADMIN_ROLES = ["helpdesk_admin", "super_admin"];

const transferBody = z.object({
  toDepartment: z.string().min(1),
  reason: z.string().min(1),
});

const idParam = z.object({ id: z.string().uuid() });

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  /** TKT-07: Transfer a ticket to another department with audit trail. */
  app.post("/v1/helpdesk/tickets/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);

    const transferId = randomUUID();
    await queue.publish(COMMANDS.transferTicket, {
      messageId: transferId,
      type: COMMANDS.transferTicket,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id: transferId,
        tenantId: ctx.tenantId,
        ticketId: id,
        toDepartment: body.toDepartment,
        reason: body.reason,
        transferredBy: ctx.actorId,
      },
    });

    return reply.code(202).send({ id: transferId, status: "accepted", correlationId: ctx.correlationId });
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
