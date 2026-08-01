import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];
const HELPDESK_ADMIN_ROLES = ["helpdesk_admin", "super_admin"];

const createNoteBody = z.object({
  content: z.string().min(1),
  visibility: z.enum(["internal", "public"]),
});

const idParam = z.object({ id: z.string().uuid() });

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  /** TKT-04: Create a note (internal or public) on a ticket. */
  app.post("/v1/helpdesk/tickets/:id/notes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createNoteBody.parse(req.body);

    // Internal notes require admin role
    if (body.visibility === "internal") {
      requireRole(ctx, HELPDESK_ADMIN_ROLES);
    }

    const noteId = randomUUID();
    await queue.publish(COMMANDS.addNote, {
      messageId: noteId,
      type: COMMANDS.addNote,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id: noteId,
        tenantId: ctx.tenantId,
        ticketId: id,
        content: body.content,
        visibility: body.visibility,
        createdBy: ctx.actorId,
      },
    });

    return reply.code(202).send({ id: noteId, status: "accepted", correlationId: ctx.correlationId });
  });

  /** TKT-04: List notes for a ticket. Public for helpdesk_user, all for admin. */
  app.get("/v1/helpdesk/tickets/:id/notes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);

    const isAdmin = ctx.roles.some((r: string) => HELPDESK_ADMIN_ROLES.includes(r));

    // Read-through cache with visibility filter
    const cacheKey = cache.makeKey(ctx.tenantId, "ticket_notes", `${id}:${isAdmin ? "all" : "public"}`);
    const data = await cache.getOrLoad<{ data: unknown[] }>(cacheKey, async () => {
      // In production this hits the repo; for now return empty
      return { data: [] };
    });

    return reply.send(data);
  });

  /** TKT-14: Reopen a ticket (requires reason). */
  app.post("/v1/helpdesk/tickets/:id/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);

    const reopenId = randomUUID();
    await queue.publish(COMMANDS.reopenTicket, {
      messageId: reopenId,
      type: COMMANDS.reopenTicket,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id: reopenId,
        tenantId: ctx.tenantId,
        ticketId: id,
        reason: body.reason,
      },
    });

    return reply.code(202).send({ id: reopenId, status: "accepted", correlationId: ctx.correlationId });
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
