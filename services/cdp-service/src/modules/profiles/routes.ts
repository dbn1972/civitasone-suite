import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as eventsRepo from "../events/repo.js";
import { validateMerge } from "./domain.js";
import * as commands from "./commands.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];
const ADMIN_ROLES = ["cdp_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  profileType: z.string().optional(),
  segmentId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const createBody = z.object({
  profileType: z.string().min(1).max(32).default("individual"),
  attributes: z.record(z.unknown()).default({}),
  sourceLineage: z.array(z.object({
    source: z.string(),
    sourceId: z.string(),
    timestamp: z.string().datetime(),
    attributes: z.array(z.string().min(1).max(64)).max(100).optional(),
  })).default([]),
});

const updateBody = z.object({
  attributes: z.record(z.unknown()).optional(),
  profileType: z.string().min(1).max(32).optional(),
  sourceLineage: z.array(z.object({
    source: z.string(),
    sourceId: z.string(),
    timestamp: z.string().datetime(),
    attributes: z.array(z.string().min(1).max(64)).max(100).optional(),
  })).optional(),
  version: z.number().int().min(1),
});

const mergeBody = z.object({
  winnerId: z.string().uuid(),
  loserId: z.string().uuid(),
});

const timelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/cdp/profiles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.search !== undefined ? { search: q.search } : {}),
      ...(q.profileType !== undefined ? { profileType: q.profileType } : {}),
      ...(q.segmentId !== undefined ? { segmentId: q.segmentId } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  app.get("/v1/cdp/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "profile", id);
    const profile = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));

    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    return reply.send({ data: repo.toView(profile) });
  });

  app.post("/v1/cdp/profiles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = createBody.parse(req.body);

    return reply.code(202).send(
      await commands.createProfile(ctx, {
        profileType: body.profileType,
        attributes: body.attributes,
        sourceLineage: body.sourceLineage,
      }),
    );
  });

  app.patch("/v1/cdp/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing || existing.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }
    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "profile has been modified; retry with current version");
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.attributes) {
      patch.attributes = { ...existing.attributes, ...body.attributes };
    }
    if (body.profileType) {
      patch.profileType = body.profileType;
    }
    if (body.sourceLineage) {
      patch.sourceLineage = [...existing.sourceLineage, ...body.sourceLineage];
    }

    return reply.code(202).send(await commands.updateProfile(ctx, id, { version: body.version, patch }));
  });

  app.post("/v1/cdp/profiles/merge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = mergeBody.parse(req.body);

    const [winner, loser] = await Promise.all([
      repo.findById(body.winnerId, ctx.tenantId),
      repo.findById(body.loserId, ctx.tenantId),
    ]);

    if (!winner) throw new HttpError(404, "NOT_FOUND", "winner profile not found");
    if (!loser) throw new HttpError(404, "NOT_FOUND", "loser profile not found");

    const validationError = validateMerge(winner, loser);
    if (validationError) {
      throw new HttpError(422, "MERGE_INVALID", validationError);
    }

    return reply.code(202).send(await commands.mergeProfiles(ctx, body));
  });

  app.get("/v1/cdp/profiles/:id/timeline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = timelineQuery.parse(req.query);

    const profile = await repo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const { rows, total } = await eventsRepo.getTimeline(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(eventsRepo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });
}
