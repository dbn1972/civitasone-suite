/**
 * steward/quality-routes.ts — CDP-010 per-profile quality + tenant-level aggregate.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as profilesRepo from "../profiles/repo.js";
import { computeProfileQuality, summarizeQuality, REQUIRED_ATTRIBUTES, STALE_AFTER_DAYS } from "./quality-domain.js";

const READ_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const STEWARD_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

/**
 * The aggregate scans a bounded sample rather than the whole tenant: quality reporting is
 * a dashboard read, and a full-table scan on every refresh would compete with the
 * ingestion path for the same connection pool. The sample size is caller-visible in the
 * response so the number is never mistaken for a census.
 */
const summaryQuery = z.object({
  sampleSize: z.coerce.number().int().min(1).max(200).default(200),
});

export async function stewardQualityRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/cdp/profiles/:id/quality — per-profile quality (CDP-010)
  app.get("/v1/cdp/profiles/:id/quality", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "profile", id);
    const profile = await cache.getOrLoad(cacheKey, () => profilesRepo.findById(id, ctx.tenantId));
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const quality = computeProfileQuality(profile.attributes);

    return reply.send({
      data: {
        profileId: id,
        score: quality.score,
        missingFields: quality.missingFields,
        staleFields: quality.staleFields,
        weights: REQUIRED_ATTRIBUTES.map((w) => ({ field: w.field, weight: w.weight })),
        staleAfterDays: STALE_AFTER_DAYS,
      },
    });
  });

  // GET /v1/cdp/steward/quality-summary — tenant-level buckets (CDP-010)
  app.get("/v1/cdp/steward/quality-summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const q = summaryQuery.parse(req.query);

    const { rows, total } = await profilesRepo.listByTenant(ctx.tenantId, q.sampleSize, 0, {
      profileType: "individual",
    });

    const summary = summarizeQuality(rows.map((r) => r.attributes));

    return reply.send({
      data: {
        buckets: summary.buckets,
        averageScore: summary.averageScore,
        topMissingFields: summary.topMissingFields,
        sampled: summary.total,
        tenantProfileTotal: total,
      },
    });
  });
}
