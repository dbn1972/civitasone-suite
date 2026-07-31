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
import { productRoutes } from "./modules/products/routes.js";
import { rateRoutes } from "./modules/rates/routes.js";
import { eligibilityRoutes } from "./modules/eligibility/routes.js";
import { bundleRoutes } from "./modules/bundles/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // RLS enforcement — set app.tenant_id GUC per request
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "catalogue-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(productRoutes);
  await app.register(rateRoutes);
  await app.register(eligibilityRoutes);
  await app.register(bundleRoutes);

  return app;
}
