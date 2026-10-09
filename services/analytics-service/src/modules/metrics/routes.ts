import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { saveMetricBody, savedMetricsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
// GAP2-ANALYTICS-ROLES-01: saved-metrics list is a read (canonical reader
// set); saving a metric persists a row (narrower write set).
import { ANALYTICS_READ_ROLES as READ_ROLES, ANALYTICS_WRITE_ROLES as WRITE_ROLES } from "../../shared/roles.js";

export async function metricRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/analytics/saved-metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, savedMetricsListSchema, await queries.listSavedMetrics(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/analytics/saved-metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = saveMetricBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.saveMetric(ctx, body));
  });

  registerErrorHandler(app);
}
