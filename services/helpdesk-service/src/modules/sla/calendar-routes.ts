/**
 * SLA Calendar, Pause/Resume, Extension, CES, and Escalation Register routes.
 *
 * Endpoints:
 *  GET    /v1/helpdesk/sla/calendars         — list business calendars
 *  POST   /v1/helpdesk/sla/calendars         — create calendar
 *  PATCH  /v1/helpdesk/sla/calendars/:id     — update calendar
 *  POST   /v1/helpdesk/tickets/:id/sla/pause — pause SLA timer
 *  POST   /v1/helpdesk/tickets/:id/sla/resume — resume SLA timer
 *  POST   /v1/helpdesk/tickets/:id/sla/extend — extend SLA deadline
 *  GET    /v1/helpdesk/sla/escalations       — escalation register view
 *  POST   /v1/helpdesk/csat/ces              — submit CES response
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, desc, gte, isNull } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { businessCalendars, type WorkDay, type Holiday } from "./calendar-schema.js";
import { slaPauses } from "./pause-schema.js";
import { slaExtensions } from "./extensions-schema.js";
import { cesResponses } from "./ces-schema.js";
import { ticketEscalations } from "./schema.js";
import { tickets } from "../tickets/schema.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];
const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];

// ─── Validators ───────────────────────────────────────────────────────────────

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
  additionalMinutes: z.number().int().min(1).max(43200), // max 30 days
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
  // ─── Business Calendars CRUD ────────────────────────────────────────────

  /** List business calendars */
  app.get("/v1/helpdesk/sla/calendars", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const query = paginationQuery.parse(req.query);

    const rows = await db.transaction((tx) =>
      tx
        .select()
        .from(businessCalendars)
        .where(eq(businessCalendars.tenantId, ctx.tenantId))
        .limit(query.limit)
        .offset(query.offset),
    );

    const [countRow] = await db.transaction((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(businessCalendars)
        .where(eq(businessCalendars.tenantId, ctx.tenantId)),
    );

    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total: countRow?.count ?? 0 },
    });
  });

  /** Create business calendar */
  app.post("/v1/helpdesk/sla/calendars", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCalendarBody.parse(req.body);

    const [created] = await db.transaction((tx) =>
      tx.insert(businessCalendars).values({
        tenantId: ctx.tenantId,
        name: body.name,
        timezone: body.timezone,
        workDays: body.workDays as WorkDay[],
        holidays: body.holidays as Holiday[],
      }).returning(),
    );

    return reply.code(201).send({ data: created });
  });

  /** Update business calendar */
  app.patch("/v1/helpdesk/sla/calendars/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateCalendarBody.parse(req.body);

    const [updated] = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(businessCalendars)
        .where(and(eq(businessCalendars.id, id), eq(businessCalendars.tenantId, ctx.tenantId)))
        .limit(1);
      if (!existing) throw new HttpError(404, "NOT_FOUND", "calendar not found");

      return tx
        .update(businessCalendars)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.timezone !== undefined && { timezone: body.timezone }),
          ...(body.workDays !== undefined && { workDays: body.workDays as WorkDay[] }),
          ...(body.holidays !== undefined && { holidays: body.holidays as Holiday[] }),
          version: sql`${businessCalendars.version} + 1`,
        })
        .where(and(eq(businessCalendars.id, id), eq(businessCalendars.version, existing.version)))
        .returning();
    });

    if (!updated) throw new HttpError(409, "CONFLICT", "concurrent modification detected");
    return reply.send({ data: updated });
  });

  // ─── SLA Pause/Resume ──────────────────────────────────────────────────

  /** Pause SLA timer for a ticket */
  app.post("/v1/helpdesk/tickets/:id/sla/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = pauseBody.parse(req.body);

    const record = await db.transaction(async (tx) => {
      // Verify ticket exists
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, id), eq(tickets.tenantId, ctx.tenantId)))
        .limit(1);
      if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");

      // Check if already paused
      const [activePause] = await tx
        .select()
        .from(slaPauses)
        .where(and(
          eq(slaPauses.ticketId, id),
          eq(slaPauses.tenantId, ctx.tenantId),
          isNull(slaPauses.resumedAt),
        ))
        .limit(1);
      if (activePause) throw new HttpError(409, "ALREADY_PAUSED", "SLA is already paused for this ticket");

      const [created] = await tx.insert(slaPauses).values({
        tenantId: ctx.tenantId,
        ticketId: id,
        pauseStatus: body.pauseStatus,
        createdBy: ctx.actorId,
      }).returning();

      return created;
    });

    return reply.code(201).send({ data: record });
  });

  /** Resume SLA timer for a ticket */
  app.post("/v1/helpdesk/tickets/:id/sla/resume", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const record = await db.transaction(async (tx) => {
      const [activePause] = await tx
        .select()
        .from(slaPauses)
        .where(and(
          eq(slaPauses.ticketId, id),
          eq(slaPauses.tenantId, ctx.tenantId),
          isNull(slaPauses.resumedAt),
        ))
        .limit(1);
      if (!activePause) throw new HttpError(404, "NOT_PAUSED", "SLA is not currently paused for this ticket");

      const [updated] = await tx
        .update(slaPauses)
        .set({ resumedAt: new Date(), version: sql`${slaPauses.version} + 1` })
        .where(eq(slaPauses.id, activePause.id))
        .returning();

      return updated;
    });

    return reply.send({ data: record });
  });

  // ─── SLA Extension ─────────────────────────────────────────────────────

  /** Extend SLA deadline with approval */
  app.post("/v1/helpdesk/tickets/:id/sla/extend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = extendBody.parse(req.body);

    const record = await db.transaction(async (tx) => {
      // Verify ticket exists
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, id), eq(tickets.tenantId, ctx.tenantId)))
        .limit(1);
      if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");

      const [created] = await tx.insert(slaExtensions).values({
        tenantId: ctx.tenantId,
        ticketId: id,
        additionalMinutes: body.additionalMinutes,
        reason: body.reason,
        approverId: body.approverId,
        createdBy: ctx.actorId,
      }).returning();

      return created;
    });

    return reply.code(201).send({ data: record });
  });

  // ─── Escalation Register ───────────────────────────────────────────────

  /** Paginated escalation register view */
  app.get("/v1/helpdesk/sla/escalations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const query = paginationQuery.parse(req.query);

    const rows = await db.transaction((tx) =>
      tx
        .select({
          id: ticketEscalations.id,
          ticketId: ticketEscalations.ticketId,
          ticketSubject: tickets.subject,
          escalatedAt: ticketEscalations.escalatedAt,
          level: ticketEscalations.level,
          reason: ticketEscalations.reason,
          escalatedBy: ticketEscalations.escalatedBy,
        })
        .from(ticketEscalations)
        .innerJoin(tickets, eq(ticketEscalations.ticketId, tickets.id))
        .where(eq(ticketEscalations.tenantId, ctx.tenantId))
        .orderBy(desc(ticketEscalations.escalatedAt))
        .limit(query.limit)
        .offset(query.offset),
    );

    const [countRow] = await db.transaction((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketEscalations)
        .where(eq(ticketEscalations.tenantId, ctx.tenantId)),
    );

    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total: countRow?.count ?? 0 },
    });
  });

  // ─── CES Survey ────────────────────────────────────────────────────────

  /** Submit CES (Customer Effort Score) response */
  app.post("/v1/helpdesk/csat/ces", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = cesBody.parse(req.body);

    const record = await db.transaction(async (tx) => {
      // Verify ticket exists
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, body.ticketId), eq(tickets.tenantId, ctx.tenantId)))
        .limit(1);
      if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");

      // Frequency cap: max 1 per ticket
      const [existingForTicket] = await tx
        .select()
        .from(cesResponses)
        .where(and(eq(cesResponses.ticketId, body.ticketId), eq(cesResponses.tenantId, ctx.tenantId)))
        .limit(1);
      if (existingForTicket) {
        throw new HttpError(409, "ALREADY_SUBMITTED", "CES response already submitted for this ticket");
      }

      // Frequency cap: max 3 per customer per 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentResponses = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(cesResponses)
        .where(and(
          eq(cesResponses.createdBy, ctx.actorId),
          eq(cesResponses.tenantId, ctx.tenantId),
          gte(cesResponses.submittedAt, thirtyDaysAgo),
        ));
      const recentCount = recentResponses[0]?.count ?? 0;
      if (recentCount >= 3) {
        throw new HttpError(429, "FREQUENCY_CAP_EXCEEDED", "maximum 3 CES responses per 30 days");
      }

      const [created] = await tx.insert(cesResponses).values({
        tenantId: ctx.tenantId,
        ticketId: body.ticketId,
        effortScore: body.effortScore,
        comment: body.comment ?? null,
        createdBy: ctx.actorId,
      }).returning();

      return created;
    });

    return reply.code(201).send({ data: record });
  });

  // ─── Error Handler ──────────────────────────────────────────────────────

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
