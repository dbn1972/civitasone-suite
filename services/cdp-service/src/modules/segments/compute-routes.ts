/**
 * segments/compute-routes.ts — CDP-005 membership recompute.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as membershipRepo from "./membership-repo.js";
import { validateCriteria, type SegmentCriteria } from "./domain.js";

const ADMIN_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

export async function segmentComputeRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/segments/:id/compute — recompute materialised membership (CDP-005)
  app.post("/v1/cdp/segments/:id/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const segment = await repo.findById(id, ctx.tenantId);
    if (!segment) {
      throw new HttpError(404, "NOT_FOUND", "segment not found");
    }

    const criteriaError = validateCriteria(segment.criteria);
    if (criteriaError !== null) {
      // A stored definition that cannot be evaluated is a business-rule failure, not a
      // malformed request: the caller sent a valid segment id.
      throw new HttpError(422, "INVALID_CRITERIA", criteriaError);
    }

    const criteria = segment.criteria as unknown as SegmentCriteria;
    const runAt = new Date();

    const memberCount = await db.transaction(async (tx) => {
      const count = await membershipRepo.recompute(tx, ctx.tenantId, id, criteria, runAt);
      await repo.updateMemberCount(tx, id, ctx.tenantId, count);

      await enqueue(tx, {
        topic: EVENTS.segmentComputed,
        eventType: EVENTS.segmentComputed,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { segmentId: id, memberCount: count, computedAt: runAt.toISOString() },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "segment_recomputed",
          resourceType: "segment",
          resourceId: id,
          outcome: "success",
          metadata: { memberCount: count },
        },
      });

      return count;
    });

    // Downstream fan-out (activation refresh, analytics) happens off the request path.
    await queue.publish(COMMANDS.computeSegment, {
      type: COMMANDS.computeSegment,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { segmentId: id, memberCount, computedAt: runAt.toISOString() },
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "segment_members", id));

    return reply.code(202).send({
      data: { segmentId: id, memberCount, computedAt: runAt.toISOString(), status: "accepted" },
    });
  });
}
