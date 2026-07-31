import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import * as identityRepo from "../identity/repo.js";
import { mergeProfiles } from "../profiles/domain.js";

const STEWARD_ROLES = ["cdp_steward", "cdp_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

const decideBody = z.object({
  mergeRequestId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(1000).optional(),
});

export async function stewardRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/cdp/steward/queue — list pending merge candidates
  app.get("/v1/cdp/steward/queue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByStatus(ctx.tenantId, q.limit, q.offset, q.status);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // POST /v1/cdp/steward/decide — approve merge or reject
  app.post("/v1/cdp/steward/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const body = decideBody.parse(req.body);

    const mergeRequest = await repo.findById(body.mergeRequestId, ctx.tenantId);
    if (!mergeRequest) {
      throw new HttpError(404, "NOT_FOUND", "merge request not found");
    }
    if (mergeRequest.status !== "pending") {
      throw new HttpError(409, "ALREADY_DECIDED", `merge request is already ${mergeRequest.status}`);
    }

    const decision = body.decision === "approve" ? "approved" : "rejected";

    await db.transaction(async (tx) => {
      const ok = await repo.decide(tx, body.mergeRequestId, ctx.tenantId, decision, ctx.actorId, body.reason);
      if (!ok) {
        throw new HttpError(409, "ALREADY_DECIDED", "merge request was decided concurrently");
      }

      // If approved, execute the merge
      if (decision === "approved") {
        const winner = await profilesRepo.findById(mergeRequest.sourceProfileId, ctx.tenantId);
        const loser = await profilesRepo.findById(mergeRequest.targetProfileId, ctx.tenantId);

        if (winner && loser) {
          const { attributes, sourceLineage } = mergeProfiles(winner, loser);
          await profilesRepo.markMerged(
            tx, winner.id, loser.id, ctx.tenantId,
            attributes, sourceLineage, loser.mergedFromIds,
          );

          // Reassign identity links from loser to winner
          await identityRepo.reassignProfile(tx, loser.id, winner.id, ctx.tenantId);
        }
      }

      await enqueue(tx, {
        topic: EVENTS.mergeDecided,
        eventType: EVENTS.mergeDecided,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          mergeRequestId: body.mergeRequestId,
          decision,
          sourceProfileId: mergeRequest.sourceProfileId,
          targetProfileId: mergeRequest.targetProfileId,
        },
      });
    });

    return reply.send({
      data: { mergeRequestId: body.mergeRequestId, decision, status: decision },
    });
  });
}
