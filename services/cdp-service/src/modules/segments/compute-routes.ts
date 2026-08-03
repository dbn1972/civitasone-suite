/**
 * segments/compute-routes.ts — CDP-005 membership recompute.
 *
 * Queue-first (CQRS): the route validates criteria and publishes; the F3 consumer
 * materialises membership, emits events, refreshes pending activation audiences, and
 * invalidates the member-list cache via markProcessed.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import * as repo from "./repo.js";
import { validateCriteria } from "./domain.js";

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

    const runAt = new Date().toISOString();

    await publishF3Write(ctx, "segment_compute", id, {
      segmentId: id,
      criteria: segment.criteria,
      computedAt: runAt,
    });

    return reply.code(202).send({
      data: {
        segmentId: id,
        computedAt: runAt,
        status: "accepted",
        correlationId: ctx.correlationId,
      },
    });
  });
}
