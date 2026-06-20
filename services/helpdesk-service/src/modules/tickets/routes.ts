import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTicketBody, idParam, ticketsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];

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
