import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { secIncidents, secBreachNotifications } from "./schema.js";
import {
  canTransition, checkCloseSegregation, computeBreachDeadline, DPDP_BREACH_WINDOW_HOURS,
  eventTopicForStatus, isBreachOverdue, timestampColumnFor, type IncidentStatus,
} from "./service.js";

const ADMIN = ["super_admin", "security_admin", "platform_admin"];

function audit(tx: repo.Tx, tenantId: string, actorId: string, correlationId: string, action: string, resourceId: string) {
  return enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId, actorId, correlationId,
    payload: { service: "admin", action, resourceType: "security_incident", resourceId, outcome: "success" },
  });
}

export async function securityIncidentRoutes(app: FastifyInstance): Promise<void> {
  // ── detect / create ──────────────────────────────────────────────────
  app.post("/v1/admin/security-incidents", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      title: z.string().min(1).max(256),
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.string().max(48).default("other"),
      description: z.string().max(8000).optional(),
      affectedAssets: z.array(z.string()).default([]),
      affectedTenants: z.array(z.string()).default([]),
      isBreach: z.boolean().default(false),
      affectedDataPrincipals: z.number().int().min(0).default(0),
    }).parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(secIncidents).values({
        id, tenantId: ctx.tenantId, title: body.title, severity: body.severity,
        category: body.category, description: body.description ?? null,
        affectedAssets: body.affectedAssets, affectedTenants: body.affectedTenants,
        isBreach: body.isBreach, affectedDataPrincipals: body.affectedDataPrincipals,
        status: "detected", reportedBy: ctx.actorId,
      });
      await repo.appendTimeline(tx, { tenantId: ctx.tenantId, incidentId: id, actorId: ctx.actorId, fromStatus: null, toStatus: "detected", note: "incident detected" });
      await enqueue(tx, {
        topic: "security.incident.detected", eventType: "security.incident.detected",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id, tenantId: ctx.tenantId, severity: body.severity, isBreach: body.isBreach, title: body.title },
      });
      await audit(tx, ctx.tenantId, ctx.actorId, ctx.correlationId, "create_security_incident", id);
    });
    return reply.code(201).send({ data: { id, status: "detected" } });
  });

  // ── list ─────────────────────────────────────────────────────────────
  app.get("/v1/admin/security-incidents", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const rows = await repo.listIncidents(ctx.tenantId);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // ── breach: overdue view (registered before :id to avoid capture) ─────
  app.get("/v1/admin/security-incidents/breach/overdue", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const all = await repo.listBreachNotifications(ctx.tenantId);
    const now = new Date();
    const overdue = all.filter((n) => isBreachOverdue(new Date(n.deadlineAt), n.status, now));
    return reply.send({ data: overdue, meta: { total: overdue.length } });
  });

  // ── detail (incident + timeline + breach notifications) ──────────────
  app.get("/v1/admin/security-incidents/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const incident = await repo.findIncident(ctx.tenantId, id);
    if (!incident) throw new HttpError(404, "NOT_FOUND", "incident not found");
    const [timeline, breachNotifications] = await Promise.all([
      repo.timelineFor(ctx.tenantId, id), repo.breachNotificationsFor(ctx.tenantId, id),
    ]);
    return reply.send({ data: { ...incident, timeline, breachNotifications } });
  });

  // ── lifecycle transition (detected→triaged→contained→resolved) ───────
  app.post("/v1/admin/security-incidents/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      toStatus: z.enum(["triaged", "contained", "resolved"]),
      note: z.string().max(2000).optional(),
      rootCause: z.string().max(4000).optional(),
      resolution: z.string().max(4000).optional(),
    }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const inc = await repo.findIncidentTx(tx, ctx.tenantId, id);
      if (!inc) throw new HttpError(404, "NOT_FOUND", "incident not found");
      const from = inc.status as IncidentStatus;
      const to = body.toStatus as IncidentStatus;
      if (!canTransition(from, to)) throw new HttpError(409, "INVALID_TRANSITION", `cannot move ${from} → ${to}`);
      const col = timestampColumnFor(to);
      const patch: Record<string, unknown> = { status: to, updatedAt: new Date(), version: inc.version + 1 };
      if (col) patch[col] = new Date();
      if (body.rootCause) patch.rootCause = body.rootCause;
      if (body.resolution) patch.resolution = body.resolution;
      await tx.update(secIncidents).set(patch).where(and(eq(secIncidents.tenantId, ctx.tenantId), eq(secIncidents.id, id)));
      await repo.appendTimeline(tx, { tenantId: ctx.tenantId, incidentId: id, actorId: ctx.actorId, fromStatus: from, toStatus: to, note: body.note ?? null });
      await enqueue(tx, {
        topic: eventTopicForStatus(to), eventType: eventTopicForStatus(to),
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id, tenantId: ctx.tenantId, from, to, severity: inc.severity },
      });
      await audit(tx, ctx.tenantId, ctx.actorId, ctx.correlationId, `incident_${to}`, id);
      return { id, status: to };
    });
    return reply.send({ data: result });
  });

  // ── close (maker-checker: closer must differ from reporter) ──────────
  app.post("/v1/admin/security-incidents/:id/close", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const inc = await repo.findIncidentTx(tx, ctx.tenantId, id);
      if (!inc) throw new HttpError(404, "NOT_FOUND", "incident not found");
      if (!canTransition(inc.status as IncidentStatus, "closed")) throw new HttpError(409, "INVALID_TRANSITION", `cannot close from ${inc.status}`);
      const segErr = checkCloseSegregation(inc.reportedBy, ctx.actorId);
      if (segErr) throw new HttpError(409, "MAKER_CHECKER", segErr);
      await tx.update(secIncidents).set({ status: "closed", closedAt: new Date(), closedBy: ctx.actorId, updatedAt: new Date(), version: inc.version + 1 })
        .where(and(eq(secIncidents.tenantId, ctx.tenantId), eq(secIncidents.id, id)));
      await repo.appendTimeline(tx, { tenantId: ctx.tenantId, incidentId: id, actorId: ctx.actorId, fromStatus: inc.status, toStatus: "closed", note: body.note ?? null });
      await enqueue(tx, {
        topic: "security.incident.closed", eventType: "security.incident.closed",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id, tenantId: ctx.tenantId, closedBy: ctx.actorId },
      });
      await audit(tx, ctx.tenantId, ctx.actorId, ctx.correlationId, "incident_closed", id);
      return { id, status: "closed" };
    });
    return reply.send({ data: result });
  });

  // ── breach notification: create (computes statutory deadline) ─────────
  app.post("/v1/admin/security-incidents/:id/breach-notifications", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // windowHours is intentionally NOT accepted: DPDP §8(6) fixes the statutory
    // window at 72h and the same admin managing the incident must not be able to
    // self-extend the compliance clock. Deadline is always detectedAt + 72h.
    const body = z.object({
      authority: z.enum(["data_protection_board", "data_principals"]),
      affectedCount: z.number().int().min(0).default(0),
    }).parse(req.body);
    const nid = randomUUID();
    const result = await db.transaction(async (tx) => {
      const inc = await repo.findIncidentTx(tx, ctx.tenantId, id);
      if (!inc) throw new HttpError(404, "NOT_FOUND", "incident not found");
      const deadline = computeBreachDeadline(new Date(inc.detectedAt), DPDP_BREACH_WINDOW_HOURS);
      await tx.insert(secBreachNotifications).values({
        id: nid, tenantId: ctx.tenantId, incidentId: id, authority: body.authority,
        status: "pending", windowHours: DPDP_BREACH_WINDOW_HOURS, deadlineAt: deadline,
        affectedCount: body.affectedCount, createdBy: ctx.actorId,
      });
      if (!inc.isBreach) {
        await tx.update(secIncidents).set({ isBreach: true, updatedAt: new Date() })
          .where(and(eq(secIncidents.tenantId, ctx.tenantId), eq(secIncidents.id, id)));
      }
      await enqueue(tx, {
        topic: "security.breach.notification_due", eventType: "security.breach.notification_due",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id: nid, incidentId: id, authority: body.authority, deadlineAt: deadline.toISOString(), affectedCount: body.affectedCount },
      });
      await audit(tx, ctx.tenantId, ctx.actorId, ctx.correlationId, "breach_notification_created", id);
      return { id: nid, incidentId: id, authority: body.authority, deadlineAt: deadline.toISOString(), status: "pending" };
    });
    return reply.code(201).send({ data: result });
  });

  // ── breach notification: mark submitted to the authority ──────────────
  app.post("/v1/admin/security-incidents/:id/breach-notifications/:nid/submit", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id, nid } = z.object({ id: z.string().uuid(), nid: z.string().uuid() }).parse(req.params);
    const body = z.object({ reference: z.string().min(1).max(128) }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const notif = await repo.findBreachTx(tx, ctx.tenantId, id, nid);
      if (!notif) throw new HttpError(404, "NOT_FOUND", "breach notification not found");
      if (notif.status !== "pending") throw new HttpError(409, "INVALID_STATE", `notification already ${notif.status}`);
      const now = new Date();
      const onTime = now.getTime() <= new Date(notif.deadlineAt).getTime();
      await tx.update(secBreachNotifications).set({ status: "submitted", submittedAt: now, reference: body.reference })
        .where(and(eq(secBreachNotifications.tenantId, ctx.tenantId), eq(secBreachNotifications.id, nid)));
      await enqueue(tx, {
        topic: "security.breach.notification_submitted", eventType: "security.breach.notification_submitted",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id: nid, incidentId: id, authority: notif.authority, onTime, reference: body.reference },
      });
      await audit(tx, ctx.tenantId, ctx.actorId, ctx.correlationId, "breach_notification_submitted", id);
      return { id: nid, status: "submitted", onTime };
    });
    return reply.send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
