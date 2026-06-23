import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { ticketsListSchema, metricsListResponseSchema, slaListResponseSchema, TicketAnalyticsSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createTicketBody, ticketNoteBody, closeTicketBody,
  assignTicketBody, resolveTicketBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const STAFF_ROLES = [
  "helpdesk_user", "helpdesk_agent", "helpdesk_admin",
  "citizen_officer", "citizen_admin", "super_admin",
];
const CITIZEN_ROLES = ["citizen", ...STAFF_ROLES];

const ticketListQuerySchema = z.object({
  limit:     z.coerce.number().int().min(1).max(500).default(50),
  offset:    z.coerce.number().int().min(0).default(0),
  slaStatus: z.enum(["within_sla", "due_soon", "breached"]).optional(),
});

export async function helpdeskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/tickets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = ticketListQuerySchema.parse(req.query);
    if (q.slaStatus) {
      const data = await queries.listTicketDetails(ctx.tenantId, q.limit, q.slaStatus);
      return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
    }
    sendValidated(reply, ticketsListSchema, await queries.listTickets(ctx.tenantId, q.limit, q.slaStatus));
  });

  app.get("/v1/citizen/analytics/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    sendValidated(reply, metricsListResponseSchema, { data: await queries.getMetrics(ctx.tenantId) });
  });

  app.get("/v1/citizen/analytics/sla-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    sendValidated(reply, slaListResponseSchema, { data: await queries.getSlaRules(ctx.tenantId) });
  });

  app.post("/v1/citizen/tickets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createTicketBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTicket(ctx, body));
  });

  app.get("/v1/citizen/tickets/analytics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    sendValidated(reply, TicketAnalyticsSchema, await queries.getTicketAnalytics(ctx.tenantId));
  });

  app.post("/v1/citizen/tickets/:id/notes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);
    const { id } = idParam.parse(req.params);
    const body = ticketNoteBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addNote(ctx, id, body));
  });

  app.patch("/v1/citizen/tickets/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignTicketBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignTicket(ctx, id, body));
  });

  app.patch("/v1/citizen/tickets/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveTicketBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.resolveTicket(ctx, id, body));
  });

  app.patch("/v1/citizen/tickets/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeTicketBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeTicket(ctx, id, body));
  });

  app.get("/v1/citizen/tickets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const ticket = await queries.getTicket(ctx.tenantId, id);
    if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");
    return reply.send(ticket);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
