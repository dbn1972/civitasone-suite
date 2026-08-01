import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const HELPDESK_ADMIN_ROLES = ["helpdesk_admin", "super_admin"];

const bulkActionBody = z.object({
  ticketIds: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(["assign", "close", "set_priority"]),
  payload: z.record(z.unknown()),
});

export async function bulkRoutes(app: FastifyInstance): Promise<void> {
  /** TKT-09: Bulk operations on tickets (max 50 per batch). */
  app.post("/v1/helpdesk/tickets/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ADMIN_ROLES);
    const body = bulkActionBody.parse(req.body);

    const batchId = randomUUID();

    // Publish per-ticket commands
    await Promise.all(
      body.ticketIds.map((ticketId) =>
        queue.publish(COMMANDS.bulkAction, {
          messageId: randomUUID(),
          type: COMMANDS.bulkAction,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: {
            batchId,
            ticketId,
            action: body.action,
            payload: body.payload,
          },
        }),
      ),
    );

    return reply.code(202).send({
      batchId,
      ticketCount: body.ticketIds.length,
      status: "accepted",
      correlationId: ctx.correlationId,
    });
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
