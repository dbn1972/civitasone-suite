/** Build the Fastify app (testable in-memory via supertest/inject). */
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
import { tenantRoutes } from "./modules/tenant/routes.js";
import { planRoutes } from "./modules/plans/routes.js";
import { subscriptionRoutes } from "./modules/subscriptions/routes.js";
import { quotaRoutes } from "./modules/quotas/routes.js";
import { settingRoutes } from "./modules/settings/routes.js";

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

  registerOpsRoutes(app, { service: "tenant-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(tenantRoutes);
  await app.register(planRoutes);
  await app.register(subscriptionRoutes);
  await app.register(quotaRoutes);
  await app.register(settingRoutes);
  const { orgHierarchyRoutes } = await import("./modules/org-hierarchy/routes.js");
  await app.register(orgHierarchyRoutes);
  const { dataMigrationRoutes } = await import("./modules/data-migration/routes.js");
  await app.register(dataMigrationRoutes);
  const { stewardshipRoutes } = await import("./modules/stewardship/routes.js");
  await app.register(stewardshipRoutes);
  const { codeListRoutes } = await import("./modules/code-lists/routes.js");
  await app.register(codeListRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
