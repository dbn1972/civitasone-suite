/**
 * measurement/routes.ts — XS-003 attribution + attach rate + uplift.
 *
 * Write pattern, and why it differs from the config modules:
 *
 *   - Cohort assignment is CONFIGURATION-shaped (one row, must be readable
 *     immediately by the caller that made it) so it writes inline in a
 *     transaction, exactly as matrix/routes.ts does.
 *   - Recording an attribution is EVENT-shaped: it arrives per outcome, at
 *     whatever rate the business transacts, and nothing needs to read it back in
 *     the same breath. It therefore goes command → consumer → outbox event and
 *     answers 202.
 *
 * The route resolves WHICH recommendation earns the credit before publishing and
 * puts the resolved id in the command payload. The route writes no row, and the
 * consumer writes exactly one — so there is no path on which both touch it.
 *
 * Reporting endpoints are pure reads: tally in SQL, compute in the pure domain.
 * No dashboard rendering lives here; analytics-service owns that surface.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as nbaRepo from "../nba/repo.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  MAX_LOOKBACK_DAYS,
  attributeOutcome,
  bpsToPercentString,
  computeAttachRate,
  computeUplift,
  type ServedTouch,
} from "./domain.js";
import { ATTRIBUTION_MODELS, COHORTS } from "./schema.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

/** Upper bound on served recommendations pulled in as attribution candidates. */
const MAX_TOUCHES = 200;

const campaignKey = z.string().trim().min(1).max(64);
/** MONEY — integer minor units as a STRING. Never a JSON number. */
const minorUnits = z.string().regex(/^\d+$/, "must be an integer minor-unit string");

const assignBody = z.object({
  campaignKey,
  subjectId: z.string().uuid(),
  cohort: z.enum(COHORTS),
  assignedAt: z.string().datetime({ offset: true }).optional(),
});

const recordBody = z.object({
  campaignKey,
  subjectId: z.string().uuid(),
  outcomeType: z.string().trim().min(1).max(48),
  outcomeRef: z.string().trim().min(1).max(128),
  productId: z.string().uuid().optional(),
  amountMinor: minorUnits.default("0"),
  currency: z.string().trim().length(3).toUpperCase(),
  occurredAt: z.string().datetime({ offset: true }),
  attributionModel: z.enum(ATTRIBUTION_MODELS).default("last_touch"),
  lookbackDays: z.coerce.number().int().min(0).max(MAX_LOOKBACK_DAYS).default(30),
  /** Restrict credit to touches recommending the outcome's product. */
  matchProduct: z.boolean().default(false),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  campaignKey: campaignKey.optional(),
  cohort: z.enum(COHORTS).optional(),
  subjectId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const metricQuery = z.object({
  campaignKey,
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const attachRateQuery = metricQuery.extend({
  cohort: z.enum(COHORTS).default("treatment"),
});

function windowOf(q: { from?: string | undefined; to?: string | undefined }): {
  from?: Date;
  to?: Date;
} {
  return {
    ...(q.from !== undefined ? { from: new Date(q.from) } : {}),
    ...(q.to !== undefined ? { to: new Date(q.to) } : {}),
  };
}

export async function measurementRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/recommendations/measurement/exposures — assign a subject to a cohort.
   * The control cohort is the holdout uplift is measured against; it receives no
   * recommendations, which is why the assignment must be recorded up front rather
   * than inferred from who happened to be served.
   */
  app.post("/v1/recommendations/measurement/exposures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = assignBody.parse(req.body);

    const existing = await repo.findExposure(ctx.tenantId, body.campaignKey, body.subjectId);
    if (existing) {
      throw new HttpError(
        409,
        "EXPOSURE_EXISTS",
        "subject is already assigned to a cohort for this campaign",
      );
    }

    const assignedAt = (body.assignedAt === undefined ? new Date() : new Date(body.assignedAt)).toISOString();
    return reply.code(202).send(
      await commands.assignExposure(ctx, {
        campaignKey: body.campaignKey,
        subjectId: body.subjectId,
        cohort: body.cohort,
        assignedAt,
      }),
    );
  });

  /**
   * POST /v1/recommendations/measurement/attributions — attribute an outcome back
   * to the recommendation that produced it.
   *
   * 202: the row is written by the consumer. The attribution DECISION is made here,
   * synchronously, because it depends on the served log the caller cannot see and
   * the caller deserves to know immediately whether credit was found.
   */
  app.post("/v1/recommendations/measurement/attributions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const body = recordBody.parse(req.body);

    const exposure = await repo.findExposure(ctx.tenantId, body.campaignKey, body.subjectId);
    if (!exposure) {
      throw new HttpError(
        422,
        "EXPOSURE_MISSING",
        "subject has no cohort assignment for this campaign; assign an exposure first",
      );
    }

    const duplicate = await repo.findAttributionByOutcome(
      ctx.tenantId,
      body.campaignKey,
      body.outcomeRef,
    );
    if (duplicate) {
      throw new HttpError(409, "ATTRIBUTION_EXISTS", "this outcome has already been attributed");
    }

    const occurredAt = new Date(body.occurredAt);

    // A control subject is never served a recommendation, so there is nothing to
    // attribute to; its conversion is the baseline, recorded with a null
    // recommendationId. Looking for touches would be wasted work at best and, if
    // one were found, would corrupt the holdout.
    let attributed: { recommendationId: string; servedAt: string; ageDays: number } | null = null;

    if (exposure.cohort === "treatment") {
      const servedAfter = new Date(occurredAt.getTime() - body.lookbackDays * 86_400_000);
      const { rows } = await nbaRepo.listForProfile(ctx.tenantId, body.subjectId, MAX_TOUCHES, 0, {
        servedAfter,
      });

      const touches: ServedTouch[] = rows.map((row) => ({
        recommendationId: row.id,
        productId: row.productId,
        servedAt: row.servedAt,
      }));

      attributed = attributeOutcome({
        touches,
        model: body.attributionModel,
        outcomeAt: occurredAt,
        lookbackDays: body.lookbackDays,
        ...(body.matchProduct && body.productId !== undefined ? { productId: body.productId } : {}),
      });
    }

    return reply.code(202).send(
      await commands.recordAttribution(ctx, {
        campaignKey: body.campaignKey,
        subjectId: body.subjectId,
        recommendationId: attributed?.recommendationId ?? null,
        outcomeType: body.outcomeType,
        outcomeRef: body.outcomeRef,
        productId: body.productId ?? null,
        amountMinor: body.amountMinor,
        currency: body.currency,
        cohort: exposure.cohort === "control" ? "control" : "treatment",
        attributionModel: body.attributionModel,
        occurredAt: occurredAt.toISOString(),
      }),
    );
  });

  /** GET /v1/recommendations/measurement/attributions — paginated attribution log. */
  app.get("/v1/recommendations/measurement/attributions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listAttributions(ctx.tenantId, q.limit, q.offset, {
      ...(q.campaignKey !== undefined ? { campaignKey: q.campaignKey } : {}),
      ...(q.cohort !== undefined ? { cohort: q.cohort } : {}),
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
      ...windowOf(q),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toAttributionView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  /** GET /v1/recommendations/measurement/attach-rate — attach rate for one cohort. */
  app.get("/v1/recommendations/measurement/attach-rate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = attachRateQuery.parse(req.query);

    const tally = await repo.tallyCohort(ctx.tenantId, q.campaignKey, q.cohort, windowOf(q));
    const metric = computeAttachRate(q.cohort, tally);

    return reply.send({
      data: {
        campaignKey: q.campaignKey,
        ...metric,
        attachRatePercent: bpsToPercentString(metric.attachRateBps),
      },
    });
  });

  /**
   * GET /v1/recommendations/measurement/uplift — treatment vs control.
   *
   * Returns nulls plus notes rather than zeros when a cohort is empty. A dashboard
   * that shows 0% for "not measured yet" is worse than one that shows nothing.
   */
  app.get("/v1/recommendations/measurement/uplift", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = metricQuery.parse(req.query);

    const window = windowOf(q);
    const treatment = await repo.tallyCohort(ctx.tenantId, q.campaignKey, "treatment", window);
    const control = await repo.tallyCohort(ctx.tenantId, q.campaignKey, "control", window);

    const metric = computeUplift(treatment, control);

    return reply.send({
      data: {
        campaignKey: q.campaignKey,
        ...metric,
        treatmentAttachRatePercent: bpsToPercentString(metric.treatment.attachRateBps),
        controlAttachRatePercent: bpsToPercentString(metric.control.attachRateBps),
        absoluteUpliftPercentPoints: bpsToPercentString(metric.absoluteUpliftBps),
        relativeUpliftPercent: bpsToPercentString(metric.relativeUpliftBps),
      },
    });
  });
}
