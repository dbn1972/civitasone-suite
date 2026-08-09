import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateComplaintTransition, classifySeverity, type ComplaintStatus, type ComplaintType } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["drainage_user", "drainage_admin", "super_admin"];
const ADMIN_ROLES = ["drainage_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
  severity: z.string().optional(),
});

const createBody = z.object({
  location: z.record(z.unknown()).optional(),
  complaintType: z.enum(["blocked_drain", "damaged_cover", "waterlogging", "overflow", "structural_damage"]),
  description: z.string().max(4000).optional(),
  photo: z.string().max(512).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const assignBody = z.object({ assignedTo: z.string().uuid(), version: z.number().int().positive() });
const resolveBody = z.object({ resolution: z.string().max(4000), version: z.number().int().positive() });
const closeBody = z.object({ version: z.number().int().positive() });

export async function complaintRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/drainage/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createBody.parse(req.body);
    const severity = body.severity ?? classifySeverity(body.complaintType as ComplaintType);
    return reply.code(202).send(await commands.createComplaint(ctx, {
      location: body.location ?? null, complaintType: body.complaintType,
      description: body.description ?? null, photo: body.photo ?? null, severity,
    }));
  });

  app.get("/v1/drainage/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, { status: q.status, severity: q.severity });
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/drainage/complaints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const complaint = await repo.findById(id, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "complaint not found");
    return reply.send({ data: repo.toView(complaint) });
  });

  app.post("/v1/drainage/complaints/:id/assign", async (req, reply) => {
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

  app.post("/v1/drainage/complaints/:id/resolve", async (req, reply) => {
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

  app.post("/v1/drainage/complaints/:id/close", async (req, reply) => {
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
}
