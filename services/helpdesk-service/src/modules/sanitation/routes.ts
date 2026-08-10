/**
 * Sanitation (BRD 5.13 SAN-001..004) — HTTP routes (CQRS: mutations return 202 Accepted).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { COMPLAINT_TYPES, ACTION_TYPES, calculateSeverity, canReopen } from "./domain.js";
import type { ComplaintRow, FieldActionRow } from "./schema.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];
const CITIZEN_ROLES = [...HELPDESK_ROLES, "citizen"];

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  ward: z.string(),
  zone: z.string(),
});

const createComplaintBody = z.object({
  reportedBy: z.string().uuid().optional(),
  location: locationSchema,
  facilityId: z.string().optional(),
  complaintType: z.enum(COMPLAINT_TYPES as [string, ...string[]]),
  description: z.string().optional(),
  photo: z.string().optional(),
  sensitiveZone: z.boolean().optional(),
});

const assignBody = z.object({
  assignedTo: z.string().uuid(),
});

const resolveBody = z.object({
  resolution: z.string().min(1),
});

const reopenBody = z.object({
  reason: z.string().min(1),
});

const createFieldActionBody = z.object({
  complaintId: z.string().uuid(),
  actionType: z.enum(ACTION_TYPES as [string, ...string[]]),
  performedBy: z.string().uuid().optional(),
  performedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  beforePhoto: z.string().optional(),
  afterPhoto: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

function complaintView(c: ComplaintRow) {
  return {
    id: c.id,
    complaintNumber: c.complaintNumber,
    reportedBy: c.reportedBy,
    location: c.location,
    facilityId: c.facilityId,
    complaintType: c.complaintType,
    description: c.description,
    photo: c.photo,
    severity: c.severity,
    status: c.status,
    assignedTo: c.assignedTo,
    assignedAt: c.assignedAt,
    resolvedAt: c.resolvedAt,
    resolution: c.resolution,
    citizenFeedbackRating: c.citizenFeedbackRating,
    reopenCount: c.reopenCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function fieldActionView(a: FieldActionRow) {
  return {
    id: a.id,
    complaintId: a.complaintId,
    actionType: a.actionType,
    performedBy: a.performedBy,
    performedAt: a.performedAt,
    notes: a.notes,
    beforePhoto: a.beforePhoto,
    afterPhoto: a.afterPhoto,
    durationMinutes: a.durationMinutes,
    createdAt: a.createdAt,
  };
}

export async function sanitationRoutes(app: FastifyInstance): Promise<void> {
  // ── Complaints ────────────────────────────────────────────────────────────

  app.post("/v1/helpdesk/sanitation/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createComplaintBody.parse(req.body);
    const severity = calculateSeverity(
      body.complaintType as Parameters<typeof calculateSeverity>[0],
      body.sensitiveZone ?? false,
    );
    return reply.code(202).send(
      await commands.createComplaint(ctx, {
        reportedBy: body.reportedBy ?? ctx.actorId,
        location: body.location,
        facilityId: body.facilityId ?? null,
        complaintType: body.complaintType,
        description: body.description ?? null,
        photo: body.photo ?? null,
        severity,
      }),
    );
  });

  app.get("/v1/helpdesk/sanitation/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rq = req.query as Record<string, unknown>;
    const status = typeof rq.status === "string" ? String(rq.status) : undefined;
    const complaintType = typeof rq.complaintType === "string" ? String(rq.complaintType) : undefined;
    const severity = typeof rq.severity === "string" ? String(rq.severity) : undefined;
    const rows = await repo.listComplaints(ctx.tenantId, { status, complaintType, severity, limit: q.limit, offset: q.offset });
    return reply.send({
      data: rows.map(complaintView),
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit },
    });
  });

  app.get("/v1/helpdesk/sanitation/complaints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const complaint = await repo.findComplaint(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    return reply.send({ data: complaintView(complaint) });
  });

  app.post("/v1/helpdesk/sanitation/complaints/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const complaint = await repo.findComplaint(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    if (complaint.status !== "reported") {
      throw new HttpError(409, "INVALID_TRANSITION", "complaint must be in reported status to acknowledge");
    }
    return reply.code(202).send(await commands.acknowledgeComplaint(ctx, id));
  });

  app.post("/v1/helpdesk/sanitation/complaints/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const complaint = await repo.findComplaint(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    if (complaint.status !== "acknowledged" && complaint.status !== "reopened") {
      throw new HttpError(409, "INVALID_TRANSITION", "complaint must be acknowledged or reopened to assign");
    }
    return reply.code(202).send(await commands.assignComplaint(ctx, id, body.assignedTo));
  });

  app.post("/v1/helpdesk/sanitation/complaints/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);
    const complaint = await repo.findComplaint(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    if (complaint.status !== "in_progress") {
      throw new HttpError(409, "INVALID_TRANSITION", "complaint must be in_progress to resolve");
    }
    return reply.code(202).send(await commands.resolveComplaint(ctx, id, body.resolution));
  });

  app.post("/v1/helpdesk/sanitation/complaints/:id/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reopenBody.parse(req.body);
    const complaint = await repo.findComplaint(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    if (!canReopen(
      complaint.status as Parameters<typeof canReopen>[0],
      complaint.resolvedAt,
      complaint.reopenCount,
    )) {
      throw new HttpError(409, "CANNOT_REOPEN", "complaint cannot be reopened (time window expired, max reopens reached, or not resolved)");
    }
    return reply.code(202).send(await commands.reopenComplaint(ctx, id, body.reason));
  });

  // ── Field actions ─────────────────────────────────────────────────────────

  app.post("/v1/helpdesk/sanitation/field-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const body = createFieldActionBody.parse(req.body);
    const complaint = await repo.findComplaint(body.complaintId, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    return reply.code(202).send(
      await commands.createFieldAction(ctx, {
        complaintId: body.complaintId,
        actionType: body.actionType,
        performedBy: body.performedBy ?? ctx.actorId,
        performedAt: body.performedAt ?? null,
        notes: body.notes ?? null,
        beforePhoto: body.beforePhoto ?? null,
        afterPhoto: body.afterPhoto ?? null,
        durationMinutes: body.durationMinutes ?? null,
      }),
    );
  });

  app.get("/v1/helpdesk/sanitation/field-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rq = req.query as Record<string, unknown>;
    const complaintId = typeof rq.complaintId === "string" ? String(rq.complaintId) : undefined;
    const rows = await repo.listFieldActions(ctx.tenantId, { complaintId, limit: q.limit, offset: q.offset });
    return reply.send({
      data: rows.map(fieldActionView),
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit },
    });
  });
}
