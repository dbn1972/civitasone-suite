/**
 * CH-14: Campaign/Conversation Analytics
 *
 * GET /v1/notification/channels/analytics/summary — aggregate delivery stats
 * GET /v1/notification/channels/analytics/campaigns/:id — campaign-specific metrics
 *
 * Read endpoints — direct DB read + cache (no CQRS needed).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { readScoped } from "../../shared/db.js";

const ALLOWED_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin", "analytics_viewer"];

const campaignIdParam = z.object({
  id: z.string().uuid(),
});

interface AnalyticsSummary {
  totalDelivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  campaignCount: number;
  conversationCount: number;
}

interface CampaignMetrics {
  campaignId: string;
  totalDelivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  failed: number;
}

export async function channelAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/notification/channels/analytics/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);

    const cacheKey = `notification:${ctx.tenantId}:analytics:summary`;
    const summary = await cache.getOrLoad<AnalyticsSummary>(cacheKey, async () => {
      return readScoped<AnalyticsSummary>(ctx.tenantId, async (_tx) => {
        // In production, this would aggregate from deliveries/campaigns tables.
        // Returning zero-state for now; consumer will populate analytics tables.
        return {
          totalDelivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          campaignCount: 0,
          conversationCount: 0,
        };
      });
    });
    return reply.send({ data: summary });
  });

  app.get("/v1/notification/channels/analytics/campaigns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = campaignIdParam.parse(req.params);

    const cacheKey = `notification:${ctx.tenantId}:analytics:campaign:${id}`;
    const metrics = await cache.getOrLoad<CampaignMetrics>(cacheKey, async () => {
      return readScoped<CampaignMetrics>(ctx.tenantId, async (_tx) => {
        // Placeholder — consumer will populate real metrics
        return {
          campaignId: id,
          totalDelivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          failed: 0,
        };
      });
    });
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
