import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { inferenceRoutes } from "./modules/inference/routes.js";
import { modelRoutes } from "./modules/models/routes.js";
import { evaluationRoutes } from "./modules/evaluations/routes.js";
import { predictionRoutes } from "./modules/predictions/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { experimentRoutes } from "./modules/experiments/routes.js";
import { formatMlMetrics } from "./modules/observability/metrics.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  // RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, {
    service: "ml-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });

  // Append ML-specific metrics to the /metrics response.
  // The onSend hook intercepts the response from registerOpsRoutes' /metrics
  // handler and appends ML prediction metrics to the Prometheus text output.
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url === "/metrics" && reply.statusCode === 200) {
      const mlLines = formatMlMetrics();
      if (mlLines.length > 0) {
        const existing = typeof payload === "string" ? payload : "";
        return existing + mlLines.join("\n") + "\n";
      }
    }
    return payload;
  });

  // Routes
  await app.register(inferenceRoutes);
  await app.register(modelRoutes);
  await app.register(evaluationRoutes);
  await app.register(predictionRoutes);
  await app.register(healthRoutes);
  await app.register(experimentRoutes);

  registerSchemaErrorHandler(app, HttpError);
  return app;
}
