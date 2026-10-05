/**
 * Voice-of-Customer routes (P2-6).
 * GET /v1/crm/sentiment/summary — aggregate: polarity mix, average score, top themes
 * GET /v1/crm/sentiment         — the underlying scored interactions
 *
 * There is no write route on purpose: a reading exists because an interaction was
 * logged, and the sentiment consumer is the only thing that produces one. Scoring
 * is not something an operator should be able to assert by hand.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  resolveContext,
  requireRole,
  HttpError,
} from "../../shared/context.js";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { POLARITIES } from "./domain.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

/** Mirrors the web gate (CRM_VIGILANCE_ROLES in apps/web roleGuard.ts). */
export const CRM_VIGILANCE_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

const polarityEnum = z.enum(["positive", "neutral", "negative"]);

const filterQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  polarity: polarityEnum.optional(),
  activityType: z.string().min(1).max(16).optional(),
});

const listSentimentQuery = listQuery.merge(filterQuery);

/**
 * An inverted range silently returns nothing, which reads as "no complaints" —
 * the most dangerous possible wrong answer for this screen. Reject it instead.
 */
function assertOrderedRange(from?: string, to?: string): void {
  if (from && to && new Date(from) > new Date(to)) {
    throw new HttpError(
      400,
      "INVALID_RANGE",
      `'from' (${from}) must not be after 'to' (${to})`,
    );
  }
}

function canSeeSensitive(ctx: RequestContext): boolean {
  return hasAnyRole(ctx, CRM_VIGILANCE_ROLES);
}

export async function sentimentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/sentiment/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = filterQuery.parse(req.query ?? {});
    assertOrderedRange(q.from, q.to);

    const summary = await queries.getVocSummary(ctx.tenantId, { ...q, excludeSensitive: !canSeeSensitive(ctx) });
    return reply.send({ data: { ...summary, polarities: POLARITIES } });
  });

  app.get("/v1/crm/sentiment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listSentimentQuery.parse(req.query ?? {});
    assertOrderedRange(q.from, q.to);
    const w = windowOf(q);

    const { rows, total } = await queries.listSentiments(
      ctx.tenantId,
      w.pageSize,
      w.offset,
      { ...q, excludeSensitive: !canSeeSensitive(ctx) },
    );
    return reply.send(listEnvelope(rows, w, total));
  });
}
