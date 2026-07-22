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
import { stagesRoutes } from "./modules/stages/routes.js";
import { provisioningRoutes } from "./modules/provisioning/routes.js";
import { moduleRoutes } from "./modules/provisioning/module-routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID() });
  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));
  registerOpsRoutes(app, { service: "install-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(stagesRoutes);
  await app.register(provisioningRoutes);
  await app.register(moduleRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
