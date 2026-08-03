/**
 * nba/ranking-routes.ts — F.6 ranked next-best-action generation surface.
 *
 * Added alongside routes.ts rather than folded into it so the existing served-log
 * endpoints keep their contract untouched.
 *
 * `generate` is a pure read-model computation: it ranks candidates and returns
 * them. It deliberately does NOT persist — recording a recommendation as served
 * stays with POST /v1/recommendations, so a rep previewing options does not
 * pollute the served log (and the history endpoint below stays meaningful).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as matrixRepo from "../matrix/repo.js";
import * as predictiveRepo from "../predictive/repo.js";
import {
  applyEligibility,
  rankActions,
  type ActionCandidate,
  type EligibilityContext,
} from "./ranking-domain.js";
import { resolveConsentGranted } from "./consent-resolution.js";
import { MAX_MATRIX_PRIORITY } from "./domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

const MAX_LIMIT = 200;
/** Upper bound on matrix rules pulled in to build the candidate set. */
const MAX_CANDIDATES = 200;

const profileParam = z.object({ profileId: z.string().uuid() });

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["served", "accepted", "rejected", "expired"]).optional(),
});

const signalsSchema = z
  .object({
    affinity: z.number().min(0).max(1).optional(),
    propensity: z.number().min(0).max(1).optional(),
    value: z.number().min(0).max(1).optional(),
    urgency: z.number().min(0).max(1).optional(),
  })
  .strict();

const eligibilitySchema = z
  .object({
    channels: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    segments: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    requiresConsent: z.boolean().optional(),
    minHealthScore: z.number().min(0).max(100).optional(),
    suppressed: z.boolean().optional(),
  })
  .strict();

/**
 * Request-supplied ranking context.
 *
 * P2-1: `hasConsent` is still ACCEPTED and then DISCARDED. Consent is a fact
 * owned by crm-service, so letting the caller assert it was a consent bypass;
 * but rejecting the key outright would turn a security fix into a 400 for any
 * client still sending it. The transform allow-lists the fields that survive,
 * so the parsed type carries no `hasConsent` and no downstream code can read it
 * even by accident — the verdict can only come from consent-resolution.ts.
 */
const generateContext = z
  .object({
    channel: z.string().trim().min(1).max(64).optional(),
    segment: z.string().trim().min(1).max(64).optional(),
    hasConsent: z.boolean().optional(),
    healthScore: z.number().min(0).max(100).optional(),
  })
  .strict()
  .transform((ctx) => ({
    ...(ctx.channel !== undefined ? { channel: ctx.channel } : {}),
    ...(ctx.segment !== undefined ? { segment: ctx.segment } : {}),
    ...(ctx.healthScore !== undefined ? { healthScore: ctx.healthScore } : {}),
  }));

const generateBody = z.object({
  profileId: z.string().uuid(),
  context: generateContext.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  weights: z
    .object({
      affinity: z.number().min(0).max(100).optional(),
      propensity: z.number().min(0).max(100).optional(),
      value: z.number().min(0).max(100).optional(),
      urgency: z.number().min(0).max(100).optional(),
    })
    .strict()
    .optional(),
  /** Explicit candidate set (ml-service already has one); otherwise built from the matrix. */
  candidates: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        actionType: z.string().trim().min(1).max(64),
        productId: z.string().uuid().optional(),
        priority: z.number().int().min(0).max(1000).optional(),
        signals: signalsSchema.default({}),
        eligibility: eligibilitySchema.optional(),
      }),
    )
    .max(MAX_CANDIDATES)
    .optional(),
});

/**
 * Convert a stored decimal propensity into a 0..1 ranking signal.
 *
 * This is the ONE place a numeric string becomes a JS number, and it never
 * leaves this function: the value is used to weight a ranking, not returned or
 * persisted. The API contract still hands the raw string to clients (see
 * predictive/repo.ts toView).
 */
function propensityFrom(score: string | null | undefined): number {
  if (score === null || score === undefined) return 0;
  const parsed = Number(score);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

export async function nbaRankingRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/recommendations/nba/generate — ranked next-best-actions. */
  app.post("/v1/recommendations/nba/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const body = generateBody.parse(req.body);

    let candidates: ActionCandidate[];

    if (body.candidates !== undefined) {
      candidates = body.candidates.map((c) => ({
        id: c.id,
        actionType: c.actionType,
        productId: c.productId ?? null,
        ...(c.priority !== undefined ? { priority: c.priority } : {}),
        signals: c.signals,
        ...(c.eligibility !== undefined ? { eligibility: c.eligibility } : {}),
      }));
    } else {
      // Cross-sell engine: the matrix supplies the candidate actions, the
      // profile's renewal model supplies the propensity signal.
      const renewal = await predictiveRepo.findBySubjectModel(
        ctx.tenantId,
        "profile",
        body.profileId,
        "renewal",
      );
      const propensity = propensityFrom(renewal?.score);

      const { rows } = await matrixRepo.listByTenant(ctx.tenantId, MAX_CANDIDATES, 0, {
        ...(body.context?.segment !== undefined ? { segment: body.context.segment } : {}),
        ...(body.context?.channel !== undefined ? { channel: body.context.channel } : {}),
      });

      candidates = rows.map((row) => {
        const normalisedPriority = Math.min(row.priority, MAX_MATRIX_PRIORITY) / MAX_MATRIX_PRIORITY;
        return {
          id: row.id,
          actionType: "cross_sell",
          productId: row.recommendedProductId,
          priority: row.priority,
          signals: { affinity: normalisedPriority, propensity, value: normalisedPriority, urgency: 0 },
        };
      });
    }

    // Consent is resolved here, at the edge, and handed to the pure domain as a
    // boolean — and only when something in the candidate set is actually gated,
    // so the ordinary request adds no CRM round-trip to the read budget.
    const consentGranted = await resolveConsentGranted(
      candidates,
      body.profileId,
      ctx.tenantId,
      ctx.correlationId,
    );

    const eligibilityContext: EligibilityContext = { ...(body.context ?? {}), consentGranted };
    const eligible = applyEligibility(candidates, eligibilityContext);
    const ranked = rankActions(eligible, body.weights).slice(0, body.limit);

    return reply.send({
      data: ranked,
      meta: {
        page: 1,
        pageSize: body.limit,
        total: eligible.length,
        profileId: body.profileId,
        candidateCount: candidates.length,
        eligibleCount: eligible.length,
      },
    });
  });

  /** GET /v1/recommendations/nba/:profileId/history — previously served recommendations. */
  app.get("/v1/recommendations/nba/:profileId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { profileId } = profileParam.parse(req.params);
    const q = historyQuery.parse(req.query);

    // No TTL/status filter by default: history is the full served log, including
    // terminal rows, which is the point of an audit surface.
    const { rows, total } = await repo.listForProfile(ctx.tenantId, profileId, q.limit, q.offset, {
      ...(q.status !== undefined ? { statuses: [q.status] } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });
}
