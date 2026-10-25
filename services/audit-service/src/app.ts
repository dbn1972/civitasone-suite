import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing, redactedReqSerializer } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerRateLimit } from "@civitasone/rate-limit";
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
import { riskRegisterRoutes } from "./modules/risk-register/routes.js";
import { vigilanceRoutes } from "./modules/vigilance/routes.js";
import { investigationRoutes } from "./modules/investigation/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // SEC: explicit request-body cap (1 MiB) -- bounds zod collection validation (GHSA-mrhx-c7xc-m3w5); guarded by scripts/ci/fastify-bodylimit-guard.mjs
    bodyLimit: 1_048_576,
    // Q34: the export download token travels in the query string; keep it out of access logs.
    logger: { level: process.env.LOG_LEVEL ?? "info", serializers: { req: redactedReqSerializer } },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // Per-user rate limiting (300 req/min keyed by actorId, ops paths excluded),
  // same shape as hrms-service. Registered so the routes that read or export
  // the audit trail can carry route-level limits (GAP-HR-AUDIT-LOG-04).
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
  // otherwise get NO GUC at all — and events.events's RLS policy calls
  // current_setting('app.tenant_id') without missing_ok, so an unset GUC
  // throws "unrecognized configuration parameter" (500) instead of merely
  // returning zero rows. Header remains the fallback; the verified JWT
  // tenant wins when present. Mirrors admin-service / hrms-service /
  // payroll-service / workflow-service / identity-service, etc. — this was
  // the one service in the fleet missing this hook.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

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
  await app.register(riskRegisterRoutes);
  await app.register(vigilanceRoutes);
  await app.register(investigationRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
