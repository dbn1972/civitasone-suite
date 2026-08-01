/**
 * dsar/routes.ts — CDP-011 DSAR intake, listing, and completion with downstream
 * propagation to segments and activations.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { DSAR_REQUEST_TYPES, DSAR_STATUSES, isCompletable, requiresDownstreamPurge } from "./domain.js";

const DSAR_READ_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const DSAR_WRITE_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];

const raiseBody = z.object({
  profileId: z.string().uuid(),
  requestType: z.enum(DSAR_REQUEST_TYPES),
  reason: z.string().min(1).max(2000).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(DSAR_STATUSES).optional(),
  profileId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const completeBody = z.object({
  version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});

export async function dsarRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/dsar — raise a request (CDP-011)
  app.post("/v1/cdp/dsar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DSAR_WRITE_ROLES);
    const body = raiseBody.parse(req.body);

    const profile = await profilesRepo.findById(body.profileId, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const id = randomUUID();
    await db.transaction(async (tx) => {
      // The register row is written synchronously so the requester gets a tracking id
      // immediately — a statutory clock cannot start on a message that may still be
      // in flight. The fulfilment work itself is asynchronous (command below).
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        profileId: body.profileId,
        requestType: body.requestType,
        status: "pending",
        reason: body.reason ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.dsarRaised,
        eventType: EVENTS.dsarRaised,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { dsarId: id, profileId: body.profileId, requestType: body.requestType, status: "pending" },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "dsar_raised",
          resourceType: "dsar_request",
          resourceId: id,
          outcome: "success",
          metadata: { profileId: body.profileId, requestType: body.requestType },
        },
      });
    });

    await queue.publish(COMMANDS.raiseDsar, {
      type: COMMANDS.raiseDsar,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { dsarId: id, profileId: body.profileId, requestType: body.requestType },
    });

    return reply.code(202).send({
      data: { id, profileId: body.profileId, requestType: body.requestType, status: "pending" },
    });
  });

  // GET /v1/cdp/dsar — list with status filter (CDP-011)
  app.get("/v1/cdp/dsar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DSAR_READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.profileId !== undefined ? { profileId: q.profileId } : {}),
    });

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // POST /v1/cdp/dsar/:id/complete — discharge and propagate (CDP-011)
  app.post("/v1/cdp/dsar/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DSAR_WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "dsar request not found");
    }
    if (!isCompletable(existing.status)) {
      throw new HttpError(422, "DSAR_TERMINAL", `dsar request is already ${existing.status}`);
    }

    const completedAt = new Date();
    await db.transaction(async (tx) => {
      const ok = await repo.complete(tx, id, ctx.tenantId, body.version, completedAt);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "dsar request has been modified; retry with current version");
      }

      // Emitted through the outbox, not published directly: the purge instruction must
      // not be delivered unless the completion actually committed.
      await enqueue(tx, {
        topic: EVENTS.dsarCompleted,
        eventType: EVENTS.dsarCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          dsarId: id,
          profileId: existing.profileId,
          requestType: existing.requestType,
          completedAt: completedAt.toISOString(),
          purgeDownstream: requiresDownstreamPurge(existing.requestType),
        },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "dsar_completed",
          resourceType: "dsar_request",
          resourceId: id,
          outcome: "success",
          metadata: { profileId: existing.profileId, requestType: existing.requestType, note: body.note ?? null },
        },
      });
    });

    return reply.send({
      data: {
        id,
        status: "completed",
        completedAt: completedAt.toISOString(),
        version: body.version + 1,
        purgeDownstream: requiresDownstreamPurge(existing.requestType),
      },
    });
  });
}
