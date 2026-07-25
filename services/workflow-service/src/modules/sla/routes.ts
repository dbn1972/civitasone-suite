import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { computeDueOnCalendar, agingMinutes } from "../../shared/calendar.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export async function slaRoutes(app: FastifyInstance): Promise<void> {
  // CAP-027 — create a working calendar (business hours + holidays).
  app.post("/v1/workflow/calendars", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(200),
      timezone: z.string().max(64).default("UTC"),
      workweek: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
      holidays: z.array(z.string().regex(dateRe)).default([]),
      workStartMinute: z.number().int().min(0).max(1440).default(540),
      workEndMinute: z.number().int().min(0).max(1440).default(1020),
    }).parse(req.body);
    if (body.workEndMinute <= body.workStartMinute) {
      throw new HttpError(400, "INVALID_WINDOW", "workEndMinute must exceed workStartMinute");
    }
    const row = await repo.createCalendar({ tenantId: ctx.tenantId, createdBy: ctx.actorId, ...body });
    return reply.code(201).send({ data: row });
  });

  app.get("/v1/workflow/calendars", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listCalendars(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // CAP-027 — preview a due date for an SLA against a working calendar.
  app.post("/v1/workflow/sla/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      calendarCode: z.string().min(1).max(64),
      slaMinutes: z.number().int().positive(),
      from: z.string().datetime().optional(),
    }).parse(req.body);
    const cal = await repo.findCalendarByCode(ctx.tenantId, body.calendarCode);
    if (!cal) throw new HttpError(404, "NOT_FOUND", "calendar not found");
    const from = body.from ? new Date(body.from) : new Date();
    const due = computeDueOnCalendar(repo.toCalendar(cal), from, body.slaMinutes);
    return reply.send({ data: { from: from.toISOString(), dueAt: due ? due.toISOString() : null } });
  });

  // CAP-027 — ageing for a window against a calendar (excludes paused minutes).
  app.post("/v1/workflow/sla/ageing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      calendarCode: z.string().min(1).max(64),
      from: z.string().datetime(),
      to: z.string().datetime(),
      pausedMinutes: z.number().int().min(0).default(0),
    }).parse(req.body);
    const cal = await repo.findCalendarByCode(ctx.tenantId, body.calendarCode);
    if (!cal) throw new HttpError(404, "NOT_FOUND", "calendar not found");
    const minutes = agingMinutes(repo.toCalendar(cal), new Date(body.from), new Date(body.to), body.pausedMinutes);
    return reply.send({ data: { agingMinutes: minutes } });
  });

  // CAP-027 — pause a task's SLA clock.
  app.post("/v1/workflow/tasks/:id/sla/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().max(256).nullable().optional() }).parse(req.body ?? {});
    const row = await repo.pauseTask(ctx.tenantId, id, body.reason ?? null, ctx.actorId);
    if (!row) throw new HttpError(409, "ALREADY_PAUSED", "task SLA is already paused");
    return reply.code(201).send({ data: row });
  });

  // CAP-027 — resume a paused SLA clock (shifts due_at by the paused span).
  app.post("/v1/workflow/tasks/:id/sla/resume", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const res = await repo.resumeTask(ctx.tenantId, id);
    if (!res) throw new HttpError(409, "NOT_PAUSED", "task SLA is not paused");
    return reply.send({ data: { taskId: id, ...res } });
  });

  // CAP-027 — the overdue work queue for the tenant.
  app.get("/v1/workflow/sla/overdue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) }).parse(req.query);
    const rows = await repo.overdueTasks(ctx.tenantId, new Date(), q.limit);
    return reply.send({ data: rows, total: rows.length });
  });

  // CAP-027 — aggregate SLA breach report.
  app.get("/v1/workflow/sla/breach-report", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const report = await repo.breachReport(ctx.tenantId, new Date());
    return reply.send({ data: report });
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
