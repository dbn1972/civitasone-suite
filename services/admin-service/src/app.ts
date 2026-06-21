import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { tenantRoutes } from "./modules/tenants/routes.js";
import { configRoutes } from "./modules/config/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { backupRoutes } from "./modules/backup/routes.js";
import { supportRoutes } from "./modules/support/routes.js";
import { apiKeyRoutes } from "./modules/api-keys/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "admin-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(tenantRoutes);
  await app.register(configRoutes);
  await app.register(healthRoutes);
  await app.register(backupRoutes);
  await app.register(supportRoutes);
  await app.register(apiKeyRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
