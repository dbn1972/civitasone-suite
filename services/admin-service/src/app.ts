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
import { tenantRoutes } from "./modules/tenants/routes.js";
import { configRoutes } from "./modules/config/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { backupRoutes } from "./modules/backup/routes.js";
import { supportRoutes } from "./modules/support/routes.js";
import { apiKeyRoutes } from "./modules/api-keys/routes.js";
import { platformConfigRoutes } from "./modules/platform-config/routes.js";
import { uploadRoutes } from "./modules/uploads/routes.js";
import { featureFlagRoutes } from "./modules/feature-flags/routes.js";
import { dataExportRoutes } from "./modules/data-export/routes.js";
import { webhookRoutes } from "./modules/webhooks/routes.js";
import { scheduledJobRoutes } from "./modules/scheduled-jobs/routes.js";
import { customDomainRoutes } from "./modules/custom-domains/routes.js";
import { changeRoutes } from "./modules/change/routes.js";

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

  // Source the RLS tenant from the AUTHENTICATED token (req.ctx, populated by
  // authPlugin's earlier onRequest hook), not just the client-supplied
  // x-tenant-id header. createTenantTxHook only enters AsyncLocalStorage when
  // x-tenant-id is present; JWT-authenticated requests without that header
  // would otherwise get no GUC and read EMPTY under FORCE RLS. Header remains
  // the fallback; the verified JWT tenant wins when present. Mirrors
  // hrms-service / payroll-service / workflow-service / identity-service.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "admin-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(tenantRoutes);
  await app.register(configRoutes);
  await app.register(healthRoutes);
  await app.register(backupRoutes);
  await app.register(supportRoutes);
  await app.register(apiKeyRoutes);
  await app.register(platformConfigRoutes);
  await app.register(uploadRoutes);
  await app.register(featureFlagRoutes);
  await app.register(dataExportRoutes);
  await app.register(webhookRoutes);
  await app.register(scheduledJobRoutes);
  await app.register(customDomainRoutes);
  await app.register(changeRoutes);
  const { adminGapRoutes } = await import("./modules/gap/routes.js");
  await app.register(adminGapRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
