/**
 * activations/routes.ts — CDP-012 activate a segment (queue-first).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as segmentsRepo from "../segments/repo.js";
import * as membershipRepo from "../segments/membership-repo.js";
import { ACTIVATION_CHANNELS, ACTIVATION_STATUSES, resolveDispatchAt } from "./domain.js";
import * as commands from "./commands.js";

const READ_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];
const ACTIVATE_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });
const activateBody = z.object({
  channel: z.enum(ACTIVATION_CHANNELS),
  scheduledAt: z.string().datetime().optional(),
});
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  channel: z.enum(ACTIVATION_CHANNELS).optional(),
  status: z.enum(ACTIVATION_STATUSES).optional(),
  segmentId: z.string().uuid().optional(),
});

export async function activationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/cdp/segments/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTIVATE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = activateBody.parse(req.body);

    const segment = await segmentsRepo.findById(id, ctx.tenantId);
    if (!segment) throw new HttpError(404, "NOT_FOUND", "segment not found");
    if (segment.status !== "active") {
      throw new HttpError(422, "SEGMENT_NOT_ACTIVE", `cannot activate a ${segment.status} segment`);
    }

    const now = new Date();
    const dispatchAt = resolveDispatchAt(body.scheduledAt, now);
    const audienceCount = await membershipRepo.countMembers(id, ctx.tenantId);

    return reply.code(202).send(
      await commands.activateSegment(ctx, {
        segmentId: id,
        channel: body.channel,
        audienceCount,
        dispatchAt: dispatchAt.toISOString(),
      }),
    );
  });

  app.get("/v1/cdp/activations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.channel !== undefined ? { channel: q.channel } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.segmentId !== undefined ? { segmentId: q.segmentId } : {}),
    });
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });
}
