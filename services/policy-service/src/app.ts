import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { roleRoutes } from "./modules/roles/routes.js";
import { bindingRoutes } from "./modules/bindings/routes.js";
import { evaluateRoutes } from "./modules/evaluate/routes.js";
import { abacRoutes } from "./modules/abac/routes.js";
import { roleFeatureRoutes } from "./modules/role-features/routes.js";
import { policyDocRoutes } from "./modules/policies/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "policy-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(roleRoutes);
  await app.register(bindingRoutes);
  await app.register(evaluateRoutes);
  await app.register(abacRoutes);
  await app.register(roleFeatureRoutes);
  await app.register(policyDocRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
