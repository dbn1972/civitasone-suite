import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as membershipRepo from "./membership-repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { validateCriteria, type SegmentCriteria } from "./domain.js";
import * as commands from "./commands.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];
const ADMIN_ROLES = ["cdp_admin", "super_admin"];

const createSegmentBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  segmentType: z.enum(["dynamic", "static"]).default("dynamic"),
  criteria: z.record(z.unknown()).default({}),
});

const updateSegmentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  criteria: z.record(z.unknown()).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  version: z.number().int().min(1),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

export async function segmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/cdp/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  app.get("/v1/cdp/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const segment = await repo.findById(id, ctx.tenantId);
    if (!segment) throw new HttpError(404, "NOT_FOUND", "segment not found");
    let memberCount = segment.memberCount;
    if (segment.segmentType === "dynamic" && segment.criteria) {
      const criteria = segment.criteria as unknown as SegmentCriteria;
      if (criteria.conditions && criteria.logic) {
        const { total } = await repo.evaluateMembers(criteria, ctx.tenantId, 0, 0);
        memberCount = total;
      }
    }
    return reply.send({ data: { ...repo.toView(segment), memberCount } });
  });

  app.get("/v1/cdp/segments/:id/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const segment = await repo.findById(id, ctx.tenantId);
    if (!segment) throw new HttpError(404, "NOT_FOUND", "segment not found");
    const page = Math.floor(q.offset / q.limit) + 1;
    const persisted = await membershipRepo.listMembers(segment.id, ctx.tenantId, q.limit, q.offset);
    if (persisted.total > 0) {
      const memberProfiles = await profilesRepo.findByIds(persisted.rows.map((m) => m.profileId), ctx.tenantId);
      return reply.send({ data: memberProfiles.map(profilesRepo.toView), meta: { page, pageSize: q.limit, total: persisted.total } });
    }
    const criteria = segment.criteria as unknown as SegmentCriteria;
    if (!criteria.conditions || !criteria.logic) {
      return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
    }
    const { profileIds, total } = await repo.evaluateMembers(criteria, ctx.tenantId, q.limit, q.offset);
    const profiles = await profilesRepo.findByIds(profileIds, ctx.tenantId);
    return reply.send({ data: profiles.map(profilesRepo.toView), meta: { page, pageSize: q.limit, total } });
  });

  app.post("/v1/cdp/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createSegmentBody.parse(req.body);
    if (body.segmentType === "dynamic" && Object.keys(body.criteria).length > 0) {
      const err = validateCriteria(body.criteria);
      if (err) throw new HttpError(400, "INVALID_CRITERIA", err);
    }
    return reply.code(202).send(await commands.createSegment(ctx, {
      name: body.name,
      description: body.description ?? null,
      segmentType: body.segmentType,
      criteria: body.criteria,
    }));
  });

  app.patch("/v1/cdp/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateSegmentBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "segment not found");
    if (body.criteria && Object.keys(body.criteria).length > 0) {
      const err = validateCriteria(body.criteria);
      if (err) throw new HttpError(400, "INVALID_CRITERIA", err);
    }
    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "segment has been modified; retry with current version");
    }
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.criteria) patch.criteria = body.criteria;
    if (body.status) patch.status = body.status;
    return reply.code(202).send(await commands.updateSegment(ctx, id, { version: body.version, patch }));
  });

  app.delete("/v1/cdp/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "segment not found");
    return reply.code(202).send(await commands.deleteSegment(ctx, id, existing.version));
  });
}
