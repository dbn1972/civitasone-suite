import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { isValidCsatRating } from "./domain.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];
const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];

const escalateBody = z.object({
  reason: z.string().min(1).max(1000),
});

const slaPolicyBody = z.object({
  priority: z.enum(["critical", "high", "medium", "low"]),
  category: z.string().max(128).nullable().optional(),
  responseMinutes: z.number().int().min(1),
  resolutionMinutes: z.number().int().min(1),
});

const csatBody = z.object({
  ticketId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export async function slaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/helpdesk/sla/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    return reply.send({ data: await queries.dashboard(ctx.tenantId) });
  });

  app.get("/v1/helpdesk/sla/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    return reply.send(await queries.listPolicies(ctx.tenantId));
  });

  app.post("/v1/helpdesk/sla/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = slaPolicyBody.parse(req.body);
    return reply.code(202).send(await commands.upsertSlaPolicy(ctx, {
      priority: body.priority,
      responseMinutes: body.responseMinutes,
      resolutionMinutes: body.resolutionMinutes,
      ...(body.category !== undefined ? { category: body.category } : {}),
    }));
  });

  app.post("/v1/helpdesk/csat", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = csatBody.parse(req.body);
    if (!isValidCsatRating(body.rating)) {
      throw new HttpError(400, "INVALID_RATING", "rating must be an integer between 1 and 5");
    }
    return reply.code(202).send(await commands.submitCsat(ctx, {
      ticketId: body.ticketId,
      rating: body.rating,
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    }));
  });

  app.get("/v1/helpdesk/csat/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    return reply.send({ data: await queries.csatStats(ctx.tenantId) });
  });

  app.post("/v1/helpdesk/tickets/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = escalateBody.parse(req.body);
    return reply.code(202).send(await commands.escalateTicket(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}
