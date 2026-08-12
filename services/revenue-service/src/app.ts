import "./shared/bigint-json.js";
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
import { rateEngineRoutes } from "./modules/rate-engine/routes.js";
import { assesseeRoutes } from "./modules/assessee/routes.js";
import { assessmentRoutes } from "./modules/assessment/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { collectionRoutes } from "./modules/collection/routes.js";
import { arrearsRoutes } from "./modules/arrears/routes.js";
import { bbpsRoutes } from "./modules/bbps/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { tradeLicenseRoutes } from "./modules/trade-license/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  // RLS enforcement — set app.tenant_id GUC per request
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "revenue-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  // Module routes
  await app.register(rateEngineRoutes);
  await app.register(assesseeRoutes);
  await app.register(assessmentRoutes);
  await app.register(billingRoutes);
  await app.register(collectionRoutes);
  await app.register(arrearsRoutes);
  await app.register(bbpsRoutes);
  await app.register(analyticsRoutes);
  await app.register(tradeLicenseRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
