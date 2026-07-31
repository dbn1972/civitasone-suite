import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS, SERVICE } from "../../topics.js";
import * as repo from "./repo.js";
import * as eventsRepo from "../events/repo.js";
import { mergeProfiles, validateMerge } from "./domain.js";

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
  })).default([]),
});

const updateBody = z.object({
  attributes: z.record(z.unknown()).optional(),
  profileType: z.string().min(1).max(32).optional(),
  sourceLineage: z.array(z.object({
    source: z.string(),
    sourceId: z.string(),
    timestamp: z.string().datetime(),
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
  // GET /v1/cdp/profiles — list with pagination, search, segment filter
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

  // GET /v1/cdp/profiles/:id — full profile with source lineage
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

  // POST /v1/cdp/profiles — create golden profile
  app.post("/v1/cdp/profiles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = createBody.parse(req.body);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        profileType: body.profileType,
        attributes: body.attributes,
        sourceLineage: body.sourceLineage,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.profileCreated,
        eventType: EVENTS.profileCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { profileId: id, profileType: body.profileType, attributes: body.attributes },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile", id));

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        profileType: body.profileType,
        attributes: body.attributes,
        sourceLineage: body.sourceLineage,
        mergedFromIds: [],
        version: 1,
      },
    });
  });

  // PATCH /v1/cdp/profiles/:id — update with attribute-level source tracking
  app.patch("/v1/cdp/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing || existing.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
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

    const updated = await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "profile has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.profileUpdated,
        eventType: EVENTS.profileUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { profileId: id, patch },
      });
      return true;
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile", id));
    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // POST /v1/cdp/profiles/merge — merge two profiles
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

    const { attributes, sourceLineage } = mergeProfiles(winner, loser);

    await db.transaction(async (tx) => {
      await repo.markMerged(tx, winner.id, loser.id, ctx.tenantId, attributes, sourceLineage, loser.mergedFromIds);

      await enqueue(tx, {
        topic: EVENTS.profilesMerged,
        eventType: EVENTS.profilesMerged,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { winnerId: winner.id, loserId: loser.id },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile", winner.id));
    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile", loser.id));

    return reply.send({
      data: { winnerId: winner.id, loserId: loser.id, status: "merged" },
    });
  });

  // GET /v1/cdp/profiles/:id/timeline — consolidated interaction timeline
  app.get("/v1/cdp/profiles/:id/timeline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = timelineQuery.parse(req.query);

    // Verify profile exists
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
