import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

// 1x1 transparent GIF pixel (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

const metricsQuery = z.object({
  templateId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

const deliveryIdParam = z.object({ deliveryId: z.string().uuid() });

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/analytics/metrics — aggregate delivery metrics
  app.get("/v1/analytics/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    const filters = metricsQuery.parse(req.query);
    const metrics = await repo.getAggregateMetrics(ctx.tenantId, {
      templateId: filters.templateId,
      campaignId: filters.campaignId,
      periodStart: filters.periodStart ? new Date(filters.periodStart) : undefined,
      periodEnd: filters.periodEnd ? new Date(filters.periodEnd) : undefined,
    });
    return reply.send({ data: metrics });
  });

  // GET /t/pixel/:deliveryId.png — tracking pixel (records open)
  app.get("/t/pixel/:deliveryId.png", async (req, reply) => {
    const params = req.params as { "deliveryId.png"?: string; deliveryId?: string };
    let deliveryId = params.deliveryId;
    if (!deliveryId && params["deliveryId.png"]) {
      deliveryId = params["deliveryId.png"].replace(/\.png$/, "");
    }

    if (deliveryId) {
      // Fire-and-forget: enqueue open event
      await queue.publish(COMMANDS.recordOpen, {
        messageId: randomUUID(),
        type: COMMANDS.recordOpen,
        tenantId: "system",
        actorId: "tracking",
        correlationId: deliveryId,
        schemaVersion: "1.0",
        payload: { tenantId: "system", deliveryId },
      }).catch(() => { /* tracking failure is non-critical */ });
    }

    return reply
      .header("Content-Type", "image/gif")
      .header("Cache-Control", "no-store, no-cache, must-revalidate")
      .send(TRANSPARENT_GIF);
  });

  // GET /t/click/:deliveryId — click tracking redirect
  app.get("/t/click/:deliveryId", async (req, reply) => {
    const params = req.params as { deliveryId?: string };
    const query = req.query as { url?: string };

    const deliveryId = params.deliveryId;
    const targetUrl = query.url;

    if (!targetUrl) {
      return reply.code(400).send({ code: "MISSING_URL", message: "url query parameter is required" });
    }

    if (deliveryId) {
      // Fire-and-forget: enqueue click event
      await queue.publish(COMMANDS.recordClick, {
        messageId: randomUUID(),
        type: COMMANDS.recordClick,
        tenantId: "system",
        actorId: "tracking",
        correlationId: deliveryId,
        schemaVersion: "1.0",
        payload: { tenantId: "system", deliveryId, linkUrl: targetUrl },
      }).catch(() => { /* tracking failure is non-critical */ });
    }

    return reply.redirect(302, targetUrl);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
