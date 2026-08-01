/**
 * INT-04: Ticket-ID Correlation in Inbox Threading
 *
 * POST /v1/notification/inbox/:conversationId/correlate — links conversation to ticket
 * GET /v1/notification/inbox/:conversationId/correlation — returns linked ticketId
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { readScoped } from "../../shared/db.js";
import { eq, and } from "drizzle-orm";
import { inboxCorrelations } from "./correlation-schema.js";

const ALLOWED_ROLES = ["notification_admin", "super_admin", "tenant_admin", "helpdesk_admin", "helpdesk_user"];

const conversationIdParam = z.object({
  conversationId: z.string().uuid(),
});

const correlateBody = z.object({
  ticketId: z.string().uuid(),
});

export async function correlationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/inbox/:conversationId/correlate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    const body = correlateBody.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.correlateInbox, {
      messageId: id,
      type: COMMANDS.correlateInbox,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: ctx.tenantId,
        conversationId,
        ticketId: body.ticketId,
      },
    });

    // Invalidate cache for this correlation
    const cacheKey = `notification:${ctx.tenantId}:correlation:${conversationId}`;
    await cache.invalidate(cacheKey);

    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/notification/inbox/:conversationId/correlation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);

    const cacheKey = `notification:${ctx.tenantId}:correlation:${conversationId}`;
    let result: { ticketId: string; createdAt: Date } | null;
    try {
      result = await cache.getOrLoad(cacheKey, async () => {
        return readScoped(ctx.tenantId, async (tx) => {
          const rows = await tx
            .select()
            .from(inboxCorrelations)
            .where(
              and(
                eq(inboxCorrelations.tenantId, ctx.tenantId),
                eq(inboxCorrelations.conversationId, conversationId),
              ),
            )
            .limit(1);
          const row = rows[0];
          if (!row) return null;
          return { ticketId: row.ticketId, createdAt: row.createdAt };
        });
      });
    } catch {
      result = null;
    }

    if (!result) {
      throw new HttpError(404, "NOT_FOUND", "no correlation found for this conversation");
    }
    return reply.send({ data: result });
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
