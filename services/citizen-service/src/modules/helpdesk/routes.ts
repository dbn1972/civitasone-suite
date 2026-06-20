import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { ticketsListSchema, metricsListResponseSchema, slaListResponseSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createTicketBody, ticketNoteBody, closeTicketBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

export async function helpdeskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/tickets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, ticketsListSchema, await queries.listTickets(ctx.tenantId, q.limit));
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

  app.post("/v1/citizen/tickets/:id/notes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = ticketNoteBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addNote(ctx, id, body));
  });

  app.patch("/v1/citizen/tickets/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
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
