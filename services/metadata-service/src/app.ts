import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { entityRoutes } from "./modules/entities/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID() });
  await app.register(authPlugin as any);
  app.addHook("onRequest", createTenantTxHook(db));
  app.addHook("onRequest", async (req) => { const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId; if (tid) tenantStorage.enterWith({ tenantId: tid }); });
  registerOpsRoutes(app, { service: "metadata-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(entityRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
