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
import { documentRoutes } from "./modules/documents/routes.js";
import { categoryRoutes } from "./modules/categories/routes.js";
import { retentionRoutes } from "./modules/retention/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { versionRoutes } from "./modules/versions/routes.js";
import { sharingRoutes } from "./modules/sharing/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { policyRoutes } from "./modules/policies/routes.js";
import { assistantRoutes } from "./modules/assistant/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "knowledge-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(documentRoutes);
  await app.register(categoryRoutes);
  await app.register(retentionRoutes);
  await app.register(searchRoutes);
  await app.register(versionRoutes);
  await app.register(sharingRoutes);
  await app.register(aiRoutes);
  await app.register(policyRoutes);
  await app.register(assistantRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
