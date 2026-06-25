import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { randomUUID } from "node:crypto";
import { HttpError } from "./shared/context.js";
import { userRoutes } from "./modules/users/routes.js";
import { rbacRoutes } from "./modules/rbac/routes.js";
import { sessionRoutes } from "./modules/sessions/routes.js";
import { mfaRoutes } from "./modules/mfa/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { syncRoutes } from "./modules/sync/routes.js";
import { apiKeyRoutes } from "./modules/apikeys/routes.js";
import { breakGlassRoutes } from "./modules/breakglass/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "identity-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(userRoutes);
  await app.register(rbacRoutes);
  await app.register(sessionRoutes);
  await app.register(mfaRoutes);
  await app.register(deviceRoutes);
  await app.register(syncRoutes);
  await app.register(apiKeyRoutes);
  await app.register(breakGlassRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
