import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { saveMetricBody, savedMetricsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = ["analytics_user", "analytics_admin", "super_admin"];

export async function metricRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/analytics/saved-metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, savedMetricsListSchema, await queries.listSavedMetrics(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/analytics/saved-metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = saveMetricBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.saveMetric(ctx, body));
  });

  registerErrorHandler(app);
}
