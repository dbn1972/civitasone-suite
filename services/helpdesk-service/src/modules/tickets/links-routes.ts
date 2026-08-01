import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];

const createLinkBody = z.object({
  targetTicketId: z.string().uuid(),
  linkType: z.enum(["parent", "child", "duplicate", "related"]),
});

const idParam = z.object({ id: z.string().uuid() });
const linkIdParams = z.object({ id: z.string().uuid(), linkId: z.string().uuid() });

export async function linksRoutes(app: FastifyInstance): Promise<void> {
  /** TKT-08: Create a link between two tickets. */
  app.post("/v1/helpdesk/tickets/:id/links", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createLinkBody.parse(req.body);

    // Self-link guard
    if (id === body.targetTicketId) {
      throw new HttpError(422, "SELF_LINK", "A ticket cannot be linked to itself");
    }

    const linkId = randomUUID();
    await queue.publish(COMMANDS.linkTickets, {
      messageId: linkId,
      type: COMMANDS.linkTickets,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id: linkId,
        tenantId: ctx.tenantId,
        sourceTicketId: id,
        targetTicketId: body.targetTicketId,
        linkType: body.linkType,
        createdBy: ctx.actorId,
      },
    });

    return reply.code(202).send({ id: linkId, status: "accepted", correlationId: ctx.correlationId });
  });

  /** TKT-08: List all links for a ticket. */
  app.get("/v1/helpdesk/tickets/:id/links", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "ticket_links", id);
    const data = await cache.getOrLoad<{ data: unknown[] }>(cacheKey, async () => {
      return { data: [] };
    });

    return reply.send(data);
  });

  /** TKT-08: Remove a link. */
  app.delete("/v1/helpdesk/tickets/:id/links/:linkId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id, linkId } = linkIdParams.parse(req.params);

    await cache.invalidateResource(ctx.tenantId, "ticket_links");
    // In full CQRS this would publish a command; for now we accept.
    return reply.code(204).send();
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
