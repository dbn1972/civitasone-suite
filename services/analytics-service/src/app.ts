import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { dashboardRoutes } from "./modules/dashboards/routes.js";
import { queryRoutes } from "./modules/queries/routes.js";
import { metricRoutes } from "./modules/metrics/routes.js";
import { activationRoutes } from "./modules/activation/routes.js";
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID() });
  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  registerOpsRoutes(app, { service: "analytics-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(dashboardRoutes);
  await app.register(queryRoutes);
  await app.register(metricRoutes);
  await app.register(activationRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
