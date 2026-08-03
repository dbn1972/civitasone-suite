/**
 * SLA Calendar, Pause/Resume, Extension, CES, and Escalation Register routes.
 * Mutations: route → zod → queue.publish → 202 Accepted (CQRS).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./calendar-queries.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];
const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];

const workDaySchema = z.object({
  day: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(255),
});

const createCalendarBody = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1).max(64).default("Asia/Kolkata"),
  workDays: z.array(workDaySchema).min(1).max(7),
  holidays: z.array(holidaySchema).default([]),
});

const updateCalendarBody = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().min(1).max(64).optional(),
  workDays: z.array(workDaySchema).min(1).max(7).optional(),
  holidays: z.array(holidaySchema).optional(),
});

const pauseBody = z.object({
  pauseStatus: z.string().min(1).max(64),
});

const extendBody = z.object({
  additionalMinutes: z.number().int().min(1).max(43200),
  reason: z.string().min(1).max(2000),
  approverId: z.string().uuid(),
});

const cesBody = z.object({
  ticketId: z.string().uuid(),
  effortScore: z.number().int().min(1).max(7),
  comment: z.string().max(2000).optional(),
});

const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/helpdesk/sla/calendars", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const query = paginationQuery.parse(req.query);
    const { rows, total } = await queries.listCalendars(ctx.tenantId, query.limit, query.offset);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
    });
  });

  app.post("/v1/helpdesk/sla/calendars", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCalendarBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCalendar(ctx, body));
  });

  app.patch("/v1/helpdesk/sla/calendars/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateCalendarBody.parse(req.body);
    const existing = await queries.findCalendar(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "calendar not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateCalendar(ctx, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.workDays !== undefined ? { workDays: body.workDays } : {}),
      ...(body.holidays !== undefined ? { holidays: body.holidays } : {}),
      expectedVersion: existing.version,
    }));
  });

  app.post("/v1/helpdesk/tickets/:id/sla/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = pauseBody.parse(req.body);
    if (!(await queries.ticketExists(ctx.tenantId, id))) {
      throw new HttpError(404, "NOT_FOUND", "ticket not found");
    }
    if (await queries.findActivePause(ctx.tenantId, id)) {
      throw new HttpError(409, "ALREADY_PAUSED", "SLA is already paused for this ticket");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.pauseSla(ctx, id, body));
  });

  app.post("/v1/helpdesk/tickets/:id/sla/resume", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await queries.findActivePause(ctx.tenantId, id))) {
      throw new HttpError(404, "NOT_PAUSED", "SLA is not currently paused for this ticket");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.resumeSla(ctx, id));
  });

  app.post("/v1/helpdesk/tickets/:id/sla/extend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = extendBody.parse(req.body);
    if (!(await queries.ticketExists(ctx.tenantId, id))) {
      throw new HttpError(404, "NOT_FOUND", "ticket not found");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.extendSla(ctx, id, body));
  });

  app.get("/v1/helpdesk/sla/escalations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const query = paginationQuery.parse(req.query);
    const { rows, total } = await queries.listEscalations(ctx.tenantId, query.limit, query.offset);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
    });
  });

  app.post("/v1/helpdesk/csat/ces", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = cesBody.parse(req.body);
    if (!(await queries.ticketExists(ctx.tenantId, body.ticketId))) {
      throw new HttpError(404, "NOT_FOUND", "ticket not found");
    }
    if (await queries.findCesForTicket(ctx.tenantId, body.ticketId)) {
      throw new HttpError(409, "ALREADY_SUBMITTED", "CES response already submitted for this ticket");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitCes(ctx, body));
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
