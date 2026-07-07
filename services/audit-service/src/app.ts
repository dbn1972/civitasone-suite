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
import { eventRoutes } from "./modules/events/routes.js";
import { exportRoutes } from "./modules/exports/routes.js";
import { planRoutes } from "./modules/plan/routes.js";
import { observationRoutes } from "./modules/observation/routes.js";
import { paraRoutes } from "./modules/para/routes.js";
import { complianceRoutes } from "./modules/compliance/routes.js";
import { checklistRoutes } from "./modules/compliance/checklist-routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { riskRoutes } from "./modules/risk/routes.js";
import { vigilanceRoutes } from "./modules/vigilance/routes.js";
import { investigationRoutes } from "./modules/investigation/routes.js";

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

  registerOpsRoutes(app, { service: "audit-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(eventRoutes);
  await app.register(exportRoutes);
  await app.register(planRoutes);
  await app.register(observationRoutes);
  await app.register(paraRoutes);
  await app.register(complianceRoutes);
  await app.register(checklistRoutes);
  await app.register(dashboardRoutes);
  await app.register(adminRoutes);
  await app.register(riskRoutes);
  await app.register(vigilanceRoutes);
  await app.register(investigationRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
