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
import { tenantLifecycleRoutes } from "./modules/tenants/lifecycle-routes.js";
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
import { centralConfigRoutes } from "./modules/central-config/routes.js";
import { integrationSettingsRoutes } from "./modules/integration-settings/routes.js";
import { integrationOpsRoutes } from "./modules/integration-ops/routes.js";
import { leadIngestionRoutes } from "./modules/lead-ingestion/routes.js";
import { compositionRoutes } from "./modules/composition/routes.js";
// World-class-gap sprint: WC-010, WC-009, CR-MOB-01, ORG-07, DM-002.
import { configArtefactRoutes } from "./modules/config/artefact-routes.js";
import { sandboxRoutes } from "./modules/sandbox/routes.js";
import { platformIntegrationRoutes } from "./modules/platform-integrations/routes.js";
import { mobileTelemetryRoutes } from "./modules/health/mobile-routes.js";
import { departmentTemplateRoutes } from "./modules/dept-templates/routes.js";
import { documentGovernanceRoutes } from "./modules/uploads/doc-routes.js";
// COMP-014: hierarchy-LEVEL taxonomy for platform-admin/org-config -- a
// distinct concept and route path from gap/routes.ts's /v1/admin/org-hierarchy
// (real org-unit INSTANCES, forwarded to tenant-service).
import { platformOpsRoutes } from "./modules/platform-ops/routes.js";
import { apiMonitoringRoutes } from "./modules/api-monitoring/routes.js";
import { orgHierarchyLevelRoutes } from "./modules/org-hierarchy-levels/routes.js";
import { tenantSettingsRoutes } from "./modules/tenant-settings/routes.js";
import { identityProviderRoutes } from "./modules/identity-providers/routes.js";
import { securityOverviewRoutes } from "./modules/gap/security-overview-routes.js";
import { registerRateLimit } from "@civitasone/rate-limit";
import { discoveryRoutes } from "./modules/discovery/routes.js";
import { platformCatalogueRoutes } from "./modules/platform-catalogue/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // SEC: explicit request-body cap (1 MiB) -- bounds zod collection validation (GHSA-mrhx-c7xc-m3w5); guarded by scripts/ci/fastify-bodylimit-guard.mjs
    bodyLimit: 1_048_576,
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
    // GET /v1/admin/uploads/:key takes a whole storage key as ONE url-encoded param (uploads/<tenant>/<category>/...,
    // 100+ chars once the slashes are %2F-encoded). Fastify's default maxParamLength of 100 answered 404 for every
    // real key, so the download route was unreachable.
    maxParamLength: 512,
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // COMP-020: baseline limiter, registered AFTER auth so the key is the verified actor. The new
  // platform-catalogue reads add a tighter per-route limit. Loopback is allow-listed by default.
  await registerRateLimit(app, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req as { ctx?: { actorId?: string } }).ctx?.actorId ?? req.ip ?? "anonymous",
    skip: (req) => (req.url ?? "").startsWith("/health") || (req.url ?? "").startsWith("/ready") || (req.url ?? "").startsWith("/metrics"),
  });

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

  // MUST be registered BEFORE any app.register(<routes>) below: Fastify child (encapsulated)
  // contexts copy the parent error handler when they are created, so a handler set after the
  // routes only covers the root context and every ZodError / HttpError thrown inside a route
  // module without its own handler fell through to Fastify default 500 (UAT API sweep 2026-10-28).
  registerSchemaErrorHandler(app, HttpError);

  registerOpsRoutes(app, { service: "admin-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(tenantRoutes);
  await app.register(tenantLifecycleRoutes);
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
  await app.register(centralConfigRoutes);
  await app.register(integrationSettingsRoutes);
  await app.register(integrationOpsRoutes);
  await app.register(leadIngestionRoutes);
  await app.register(compositionRoutes);
  await app.register(configArtefactRoutes);
  await app.register(sandboxRoutes);
  await app.register(mobileTelemetryRoutes);
  await app.register(departmentTemplateRoutes);
  await app.register(documentGovernanceRoutes);
  await app.register(orgHierarchyLevelRoutes);
  await app.register(platformOpsRoutes);
  await app.register(tenantSettingsRoutes);
  await app.register(identityProviderRoutes);
  await app.register(securityOverviewRoutes);
  await app.register(discoveryRoutes);
  await app.register(platformIntegrationRoutes);
  await app.register(apiMonitoringRoutes);
  await app.register(platformCatalogueRoutes);
  const { adminGapRoutes } = await import("./modules/gap/routes.js");
  await app.register(adminGapRoutes);

  const { securityComplianceRoutes } = await import("./modules/security-compliance/routes.js");
  await app.register(securityComplianceRoutes);
  const { securityIncidentRoutes } = await import("./modules/security-incident/routes.js");
  await app.register(securityIncidentRoutes);
  return app;
}
