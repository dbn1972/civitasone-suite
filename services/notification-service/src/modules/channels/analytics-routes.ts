/**
 * CH-14: Campaign/Conversation Analytics
 *
 * GET /v1/notification/channels/analytics/summary — aggregate delivery stats
 * GET /v1/notification/channels/analytics/campaigns/:id — campaign-specific metrics
 *
 * Read endpoints — direct DB read + cache (no CQRS needed).
 *
 * DOM-015: both endpoints used to return a hardcoded all-zero object as a
 * plain 200 — indistinguishable from a tenant that genuinely has zero
 * delivery/engagement activity, and (for the per-campaign endpoint) identical
 * for a real campaign id and a made-up one. `./analytics-repo.js` now computes
 * every field with a real COUNT against the tables that already record it;
 * see its header comment for which tables and why they were already real.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./analytics-repo.js";
import type { ChannelAnalyticsSummary, CampaignChannelMetrics } from "./analytics-repo.js";

const ALLOWED_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin", "analytics_viewer"];

const campaignIdParam = z.object({
  id: z.string().uuid(),
});

export async function channelAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/notification/channels/analytics/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);

    const cacheKey = `notification:${ctx.tenantId}:analytics:summary`;
    const summary = await cache.getOrLoad<ChannelAnalyticsSummary>(cacheKey, () => repo.getChannelAnalyticsSummary(ctx.tenantId));
    return reply.send({ data: summary });
  });

  app.get("/v1/notification/channels/analytics/campaigns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = campaignIdParam.parse(req.params);

    const cacheKey = `notification:${ctx.tenantId}:analytics:campaign:${id}`;
    const metrics = await cache.getOrLoad<CampaignChannelMetrics | null>(cacheKey, () => repo.getCampaignChannelMetrics(ctx.tenantId, id));
    if (!metrics) {
      throw new HttpError(404, "NOT_FOUND", "campaign not found");
    }
    return reply.send({ data: metrics });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (err && typeof err === "object" && "issues" in err && (err as { name?: string }).name === "ZodError")) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
