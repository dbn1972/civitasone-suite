/**
 * profiles/scores-routes.ts — CDP-009 predictive score upsert + read.
 * ml-service is the writer; segments and activation are the readers.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import * as repo from "./scores-repo.js";
import * as profilesRepo from "./repo.js";

const READ_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];
/** ml_service is a service-to-service caller; it writes scores but reads nothing else. */
const WRITE_ROLES = ["cdp_admin", "super_admin", "tenant_admin", "ml_service"];

const scoreParams = z.object({
  id: z.string().uuid(),
  scoreType: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "scoreType must be lower_snake_case"),
});

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * The score is accepted as a number in JSON (that is what a model emits) but is stored
 * and returned as a decimal string. numeric(6,4) means at most 4 decimal places, so the
 * value is normalised to exactly that before it reaches the database — otherwise Postgres
 * would round silently and the caller would never know its input was altered.
 */
const upsertBody = z.object({
  score: z.number().min(0).max(99).finite(),
  modelVersion: z.string().min(1).max(64).default("unknown"),
  computedAt: z.string().datetime().optional(),
});

export function toStoredScore(score: number): string {
  return score.toFixed(4);
}

export async function profileScoreRoutes(app: FastifyInstance): Promise<void> {
  // PUT /v1/cdp/profiles/:id/scores/:scoreType — upsert a score (CDP-009)
  app.put("/v1/cdp/profiles/:id/scores/:scoreType", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, scoreType } = scoreParams.parse(req.params);
    const body = upsertBody.parse(req.body);

    const profile = await profilesRepo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const stored = toStoredScore(body.score);
    const computedAt = body.computedAt === undefined ? new Date() : new Date(body.computedAt);
    const existing = await repo.findByType(id, ctx.tenantId, scoreType);
    const scoreId = existing?.id ?? randomUUID();

    await publishF3Write(ctx, "score_upsert", scoreId, {
      profileId: id,
      scoreType,
      score: stored,
      modelVersion: body.modelVersion,
      computedAt: computedAt.toISOString(),
      existing: existing ? { id: existing.id, version: existing.version } : null,
    });

    return reply.status(202).send({
      data: {
        id: scoreId,
        profileId: id,
        scoreType,
        score: stored,
        modelVersion: body.modelVersion,
        computedAt: computedAt.toISOString(),
        created: existing === null,
        status: "accepted",
        correlationId: ctx.correlationId,
      },
    });
  });

  // GET /v1/cdp/profiles/:id/scores — list scores (CDP-009)
  app.get("/v1/cdp/profiles/:id/scores", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const profile = await profilesRepo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const { rows, total } = await repo.listByProfile(id, ctx.tenantId, q.limit, q.offset);

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });
}
