import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateCollectionTransition, type CollectionStatus, validateTaskTransition, type FieldTaskStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["swm_user", "swm_admin", "super_admin"];
const ADMIN_ROLES = ["swm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const requestBody = z.object({
  wasteType: z.enum(["construction_debris", "garden_waste", "e_waste", "hazardous", "bulky_item"]),
  estimatedQuantity: z.string().max(128).optional(),
  address: z.record(z.unknown()).optional(),
  preferredDate: z.string().optional(),
  preferredSlot: z.string().max(24).optional(),
  feeMinor: z.number().int().nonnegative().optional(),
});

const scheduleBody = z.object({ vehicleId: z.string().min(1), version: z.number().int().positive() });
const transitionBody = z.object({ version: z.number().int().positive() });

const fieldTaskBody = z.object({
  routeId: z.string().max(64).optional(),
  zoneId: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  taskDate: z.string().optional(),
  assetRefs: z.array(z.string()).optional(),
});

const completeTaskBody = z.object({
  notes: z.string().max(4000).optional(),
  photos: z.array(z.string().max(512)).optional(),
  version: z.number().int().positive(),
});

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/swm/collection-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = requestBody.parse(req.body);
    return reply.code(202).send(await commands.requestCollection(ctx, {
      wasteType: body.wasteType, estimatedQuantity: body.estimatedQuantity ?? null,
      address: body.address ?? null, preferredDate: body.preferredDate ?? null,
      preferredSlot: body.preferredSlot ?? null, feeMinor: body.feeMinor ?? null,
    }));
  });

  app.get("/v1/swm/collection-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listRequests(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.requestToView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/swm/collection-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const request = await repo.findRequestById(id, ctx.tenantId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "collection request not found");
    return reply.send({ data: repo.requestToView(request) });
  });

  app.post("/v1/swm/collection-requests/:id/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = scheduleBody.parse(req.body);
    const existing = await repo.findRequestById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "collection request not found");
    const err = validateCollectionTransition(existing.status as CollectionStatus, "scheduled");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.scheduleCollection(ctx, id, body.vehicleId, body.version));
  });

  app.post("/v1/swm/collection-requests/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findRequestById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "collection request not found");
    const err = validateCollectionTransition(existing.status as CollectionStatus, "collected");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.completeCollection(ctx, id, body.version));
  });

  app.post("/v1/swm/collection-requests/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findRequestById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "collection request not found");
    const err = validateCollectionTransition(existing.status as CollectionStatus, "cancelled");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.cancelCollection(ctx, id, body.version));
  });

  app.post("/v1/swm/field-tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = fieldTaskBody.parse(req.body);
    return reply.code(202).send(await commands.createFieldTask(ctx, {
      routeId: body.routeId ?? null, zoneId: body.zoneId ?? null,
      assignedTo: body.assignedTo ?? null, taskDate: body.taskDate ?? null,
      assetRefs: body.assetRefs ?? null,
    }));
  });

  app.get("/v1/swm/field-tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listTasks(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.taskToView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/swm/field-tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const task = await repo.findTaskById(id, ctx.tenantId);
    if (!task) throw new HttpError(404, "NOT_FOUND", "field task not found");
    return reply.send({ data: repo.taskToView(task) });
  });

  app.post("/v1/swm/field-tasks/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeTaskBody.parse(req.body);
    const existing = await repo.findTaskById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "field task not found");
    // BUG FIX: this route was missing the synchronous pre-accept transition
    // check that every other F3 write route in this service performs (see
    // assign/resolve/close, suspend, schedule/complete/cancel, resolve
    // above). Without it, a task could be "completed" straight from
    // "assigned" — skipping "in_progress" — because the async consumer only
    // enforces the optimistic-lock version, never the domain transition.
    const err = validateTaskTransition(existing.status as FieldTaskStatus, "completed");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.completeFieldTask(ctx, id, body.notes ?? null, body.photos ?? null, body.version));
  });
}
