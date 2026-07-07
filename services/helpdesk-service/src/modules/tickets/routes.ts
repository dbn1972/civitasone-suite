import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTicketBody, assignTicketBody, transitionTicketBody, idParam, ticketsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import type { TicketType } from "./itil-domain.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];
const HELPDESK_ADMIN_ROLES = ["helpdesk_admin", "super_admin"];

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/helpdesk/tickets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const body = createTicketBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createTicket(ctx, body));
  });

  app.get("/v1/helpdesk/tickets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, ticketsListSchema, await queries.listTickets(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/helpdesk/tickets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const ticket = await queries.getTicket(id, ctx.tenantId);
    if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");
    return reply.send(ticket);
  });

  // HD2 — assign a ticket to an agent (admin-gated).
  app.post("/v1/helpdesk/tickets/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignTicketBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.assignTicket(ctx, id, body));
  });

  // ITIL — transition a ticket's status per its type-specific workflow.
  app.post("/v1/helpdesk/tickets/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionTicketBody.parse(req.body);

    // Fetch ticket to determine its type and current status
    const ticket = await queries.getTicketRaw(id, ctx.tenantId);
    if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");
    if (!ticket.ticketType) {
      throw new HttpError(422, "NO_TICKET_TYPE", "Cannot transition a ticket without a defined ticket type");
    }

    sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.transitionTicket(ctx, id, ticket.ticketType as TicketType, ticket.status, body),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
