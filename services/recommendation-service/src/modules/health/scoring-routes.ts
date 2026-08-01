/**
 * health/scoring-routes.ts — KA-004 banded account health surface.
 * Added alongside routes.ts; the existing health endpoints are untouched.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { toIso } from "../../shared/iso.js";
import * as scoringRepo from "./scoring-repo.js";
import {
  BAND_UPPER_BOUNDS,
  bandOf,
  computeHealthScore,
  type HealthSignals,
} from "./scoring-domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

const MAX_LIMIT = 200;

const accountParam = z.object({ accountId: z.string().uuid() });

const atRiskQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
});

/**
 * Stored factors are free-form jsonb (older rows use the RFM factor names from
 * domain.ts). Only the KA-004 signal names are read; anything else is ignored so
 * a legacy row still produces a usable breakdown rather than a 500.
 */
function signalsFrom(factors: Record<string, unknown>): HealthSignals {
  const pick = (key: string): number | undefined => {
    const raw = factors[key];
    return typeof raw === "number" ? raw : undefined;
  };
  return {
    productUsage: pick("productUsage"),
    engagement: pick("engagement"),
    supportBurden: pick("supportBurden"),
    paymentTimeliness: pick("paymentTimeliness"),
    relationshipDepth: pick("relationshipDepth"),
  };
}

export async function healthScoringRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/recommendations/health/at-risk — critical + at_risk watchlist.
   * Registered before the :accountId routes read as a static path, so it never
   * collides with GET /v1/recommendations/health/:accountId.
   */
  app.get("/v1/recommendations/health/at-risk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = atRiskQuery.parse(req.query);

    // at_risk is the higher of the two watchlist bands, so its ceiling is the cut-off.
    const { rows, total } = await scoringRepo.listAtRisk(ctx.tenantId, BAND_UPPER_BOUNDS.at_risk, q.limit);

    return reply.send({
      data: rows.map((r) => ({
        accountId: r.accountId,
        score: r.score,
        band: bandOf(r.score),
        computedAt: toIso(r.computedAt),
      })),
      meta: { page: 1, pageSize: q.limit, total },
    });
  });

  /** GET /v1/recommendations/health/:accountId/breakdown — score, band, factors. */
  app.get("/v1/recommendations/health/:accountId/breakdown", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { accountId } = accountParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "health-breakdown", accountId);
    const row = await cache.getOrLoad(cacheKey, () => scoringRepo.findCurrent(ctx.tenantId, accountId));
    if (!row) throw new HttpError(404, "NOT_FOUND", "no health score computed for this account");

    // Recomputed from the stored signals so score, band and factors can never
    // disagree with each other in the response.
    const breakdown = computeHealthScore(signalsFrom(row.factors));

    return reply.send({
      data: {
        accountId: row.accountId,
        /** Persisted score kept for reference; `score` is the banded value. */
        storedScore: row.score,
        score: breakdown.score,
        band: breakdown.band,
        contributingFactors: breakdown.contributingFactors,
        computedAt: toIso(row.computedAt),
        version: row.version,
      },
    });
  });
}
