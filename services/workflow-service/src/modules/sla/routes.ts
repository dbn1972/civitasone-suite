import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { computeDueOnCalendar, agingMinutes } from "../../shared/calendar.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export async function slaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/calendars", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      code: z.string().min(1).max(64), name: z.string().min(1).max(200),
      timezone: z.string().max(64).default("UTC"),
      workweek: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
      holidays: z.array(z.string().regex(dateRe)).default([]),
      workStartMinute: z.number().int().min(0).max(1440).default(540),
      workEndMinute: z.number().int().min(0).max(1440).default(1020),
    }).parse(req.body);
    if (body.workEndMinute <= body.workStartMinute) throw new HttpError(400, "INVALID_WINDOW", "workEndMinute must exceed workStartMinute");
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCalendar(ctx, body));
  });
  app.get("/v1/workflow/calendars", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    return reply.send({ data: await repo.listCalendars(ctx.tenantId) });
  });
  app.post("/v1/workflow/sla/preview", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({ calendarCode: z.string().min(1).max(64), slaMinutes: z.number().int().positive(), from: z.string().datetime().optional() }).parse(req.body);
    const cal = await repo.findCalendarByCode(ctx.tenantId, body.calendarCode);
    if (!cal) throw new HttpError(404, "NOT_FOUND", "calendar not found");
    const from = body.from ? new Date(body.from) : new Date();
    const due = computeDueOnCalendar(repo.toCalendar(cal), from, body.slaMinutes);
    return reply.send({ data: { from: from.toISOString(), dueAt: due ? due.toISOString() : null } });
  });
  app.post("/v1/workflow/sla/ageing", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({ calendarCode: z.string().min(1).max(64), from: z.string().datetime(), to: z.string().datetime(), pausedMinutes: z.number().int().min(0).default(0) }).parse(req.body);
    const cal = await repo.findCalendarByCode(ctx.tenantId, body.calendarCode);
    if (!cal) throw new HttpError(404, "NOT_FOUND", "calendar not found");
    return reply.send({ data: { agingMinutes: agingMinutes(repo.toCalendar(cal), new Date(body.from), new Date(body.to), body.pausedMinutes) } });
  });
  app.post("/v1/workflow/tasks/:id/sla/pause", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().max(256).nullable().optional() }).parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.pauseTaskSla(ctx, id, { reason: body.reason ?? null }));
  });
  app.post("/v1/workflow/tasks/:id/sla/resume", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.resumeTaskSla(ctx, id));
  });
  app.get("/v1/workflow/sla/overdue", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) }).parse(req.query);
    const rows = await repo.overdueTasks(ctx.tenantId, new Date(), q.limit);
    return reply.send({ data: rows, total: rows.length });
  });
  app.get("/v1/workflow/sla/breach-report", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    return reply.send({ data: await repo.breachReport(ctx.tenantId, new Date()) });
  });
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
