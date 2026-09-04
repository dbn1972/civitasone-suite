import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateComplaintTransition, type ComplaintStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["sewerage_user", "sewerage_admin", "super_admin"];
const ADMIN_ROLES = ["sewerage_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const createBody = z.object({
  location: z.record(z.unknown()).optional(),
  complaintType: z.enum(["blockage", "overflow", "manhole_damage", "odour", "backflow"]),
  description: z.string().max(4000).optional(),
  photo: z.string().max(512).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const assignBody = z.object({ assignedTo: z.string().uuid(), version: z.number().int().positive() });
const resolveBody = z.object({ resolution: z.string().max(4000), version: z.number().int().positive() });
const closeBody = z.object({ version: z.number().int().positive() });

const fieldRecordBody = z.object({
  complaintId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  assetRef: z.string().max(64).optional(),
  manholeRef: z.string().max(64).optional(),
  workPerformed: z.string().max(4000).optional(),
  beforePhoto: z.string().max(512).optional(),
  afterPhoto: z.string().max(512).optional(),
});

export async function complaintRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sewerage/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createComplaint(ctx, {
      location: body.location ?? null, complaintType: body.complaintType,
      description: body.description ?? null, photo: body.photo ?? null, severity: body.severity ?? null,
    }));
  });

  app.get("/v1/sewerage/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/sewerage/complaints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const complaint = await repo.findById(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    return reply.send({ data: repo.toView(complaint) });
  });

  app.post("/v1/sewerage/complaints/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    const err = validateComplaintTransition(existing.status as ComplaintStatus, "assigned");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.assignComplaint(ctx, id, body.assignedTo, body.version));
  });

  app.post("/v1/sewerage/complaints/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    const err = validateComplaintTransition(existing.status as ComplaintStatus, "resolved");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.resolveComplaint(ctx, id, body.resolution, body.version));
  });

  app.post("/v1/sewerage/complaints/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    const err = validateComplaintTransition(existing.status as ComplaintStatus, "closed");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.closeComplaint(ctx, id, body.version));
  });

  app.post("/v1/sewerage/field-records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = fieldRecordBody.parse(req.body);

    // Pre-accept check: if a complaintId is supplied, it must reference a
    // real complaint in this tenant. Previously this route published
    // fieldRecordCreate for ANY UUID-shaped complaintId (or none at all)
    // with no existence check whatsoever, so a field record could be
    // created referencing a complaint that never existed.
    if (body.complaintId) {
      const complaint = await repo.findById(body.complaintId, ctx.tenantId);
      if (!complaint) throw new HttpError(404, "COMPLAINT_NOT_FOUND", "referenced complaint not found");
    }

    return reply.code(202).send(await commands.createFieldRecord(ctx, {
      complaintId: body.complaintId ?? null, bookingId: body.bookingId ?? null,
      assetRef: body.assetRef ?? null, manholeRef: body.manholeRef ?? null,
      workPerformed: body.workPerformed ?? null, beforePhoto: body.beforePhoto ?? null,
      afterPhoto: body.afterPhoto ?? null,
    }));
  });
}
