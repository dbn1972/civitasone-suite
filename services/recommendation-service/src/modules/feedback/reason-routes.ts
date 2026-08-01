/**
 * feedback/reason-routes.ts — CR-AI-03 rejection-reason reporting.
 * The accept/reject endpoints themselves live in nba/routes.ts (they own the
 * /v1/recommendations/:id/* path space and the recommendation state machine).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as reasonRepo from "./reason-repo.js";
import { REJECTION_REASON_CODES, completeRejectionSummary } from "./reason-domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

const summaryQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function feedbackReasonRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/recommendations/feedback/rejection-summary — counts by reasonCode. */
  app.get("/v1/recommendations/feedback/rejection-summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = summaryQuery.parse(req.query);

    const filters = {
      ...(q.from !== undefined ? { from: new Date(q.from) } : {}),
      ...(q.to !== undefined ? { to: new Date(q.to) } : {}),
    };

    const [counts, total] = await Promise.all([
      reasonRepo.rejectionSummary(ctx.tenantId, filters),
      reasonRepo.totalRejections(ctx.tenantId, filters),
    ]);

    // Every code is always present (count 0 when unused) so the dashboard does
    // not have to special-case missing series.
    const summary = completeRejectionSummary(counts);
    const coded = summary.reduce((sum, row) => sum + row.count, 0);

    return reply.send({
      data: {
        summary,
        reasonCodes: REJECTION_REASON_CODES,
        totalRejections: total,
        /** Rejections recorded before CR-AI-03 shipped, so they carry no code. */
        uncodedRejections: Math.max(0, total - coded),
      },
    });
  });
}
