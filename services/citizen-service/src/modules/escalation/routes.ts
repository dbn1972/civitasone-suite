import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { safeText } from "../../shared/sanitize.js";
import * as commands from "../helpdesk/commands.js";
import * as repo from "../helpdesk/repo.js";

const STAFF_ROLES = [
  "helpdesk_user", "helpdesk_agent", "helpdesk_admin",
  "citizen_officer", "citizen_admin", "super_admin", "admin",
];

const escalateBody = z.object({
  // P1-7: capped, control-char-stripped, CSV-injection-guarded free text.
  reason: safeText({ max: 1000, multiline: true }),
  assignedTo: z.string().uuid().optional(),
});

export async function escalationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/tickets/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = escalateBody.parse(req.body);
    const result = await commands.escalateTicket(ctx, id, { reason: body.reason });
    if (body.assignedTo) {
      await commands.assignTicket(ctx, id, { assigneeId: body.assignedTo });
    }
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  app.get("/v1/citizen/sla/breaches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const breached = await repo.listTicketsByTenant(ctx.tenantId, undefined, q.limit + q.offset, "breached");
    const rows = breached.slice(q.offset, q.offset + q.limit).map((t) => ({
      id: t.id,
      tenantId: t.tenantId,
      ticketId: t.id,
      breachedAt: (t.slaDueAt ?? t.createdAt).toISOString(),
      slaHours: 24,
      actualHours: Math.round((Date.now() - t.createdAt.getTime()) / 3600000),
    }));
    return reply.send({ data: rows, total: breached.length });
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
