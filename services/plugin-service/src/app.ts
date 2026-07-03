import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { itemsRoutes } from "./modules/items/routes.js";
import { registryRoutes } from "./modules/registry/routes.js";
import { hooksRoutes } from "./modules/hooks/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID() });
  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  registerOpsRoutes(app, { service: "plugin-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(itemsRoutes);
  await app.register(registryRoutes);
  await app.register(hooksRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
