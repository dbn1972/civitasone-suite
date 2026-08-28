/**
 * Fastify application factory for inspection-service.
 * Registers auth plugin, CORS, health/metrics routes, error handler, and RLS hooks.
 *
 * All module routes (capa, enforcement, licence, survey, telemetry, findings,
 * universe, risk, planning, assignment, checklist, sync, evidence, execution) are
 * registered below so their HTTP create/read paths are reachable in production.
 *
 * _Requirements: 1.1, 1.2, 1.5, 1.6, 1.9_
 */
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

/** Required environment variables — fail-fast on startup if missing. */
const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "QUEUE_DRIVER",
  "S3_BUCKET_NAME",
  "HRMS_SERVICE_URL",
] as const;

/**
 * Validate required environment variables are present. Throws with a
 * descriptive message listing all missing vars so operators can fix in one pass.
 */
function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `inspection-service: missing required environment variables: ${missing.join(", ")}. ` +
        "See .env.example for reference.",
    );
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  // Fail-fast: crash on startup with descriptive error if config is incomplete.
  validateEnv();

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
  // authPlugin's earlier onRequest hook). Without this the app.tenant_id GUC
  // stays unset and RLS fail-closed policies return zero rows on reads.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  // Register ops routes: /health, /ready, /metrics (no auth required).
  registerOpsRoutes(app, {
    service: "inspection-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });

  // Uniform Zod + HTTP error envelope — must be registered BEFORE route modules
  // so each encapsulated child inherits it at load time.
  registerSchemaErrorHandler(app, HttpError);

  // Module routes
  const { registerCapaRoutes } = await import("./modules/capa/routes.js");
  const { registerEnforcementRoutes } = await import("./modules/enforcement/routes.js");
  const { registerLicenceRoutes } = await import("./modules/licence/routes.js");
  const { registerSurveyRoutes } = await import("./modules/survey/routes.js");
  const { registerTelemetryRoutes } = await import("./modules/telemetry/routes.js");
  const { registerFindingsRoutes } = await import("./modules/findings/routes.js");
  const { registerUniverseRoutes } = await import("./modules/universe/routes.js");
  const { registerRiskRoutes } = await import("./modules/risk/routes.js");
  const { registerPlanningRoutes } = await import("./modules/planning/routes.js");
  const { registerAssignmentRoutes } = await import("./modules/assignment/routes.js");
  const { registerChecklistRoutes } = await import("./modules/checklist/routes.js");
  const { registerSyncRoutes } = await import("./modules/sync/routes.js");
  const { registerEvidenceRoutes } = await import("./modules/evidence/routes.js");
  const { registerExecutionRoutes } = await import("./modules/execution/routes.js");
  const { registerDashboardRoutes } = await import("./modules/dashboard/routes.js");
  const { registerReportsRoutes } = await import("./modules/reports/routes.js");
  // encroachment/illegal-construction were fully built (routes, commands,
  // domain, repo, schema) but never registered here — see this PR for the
  // full story (also missing: consumer.ts, and the CREATE TABLE migrations
  // for both modules' schemas, all fixed alongside this).
  const { registerEncroachmentRoutes } = await import("./modules/encroachment/routes.js");
  const { registerIllegalConstructionRoutes } = await import("./modules/illegal-construction/routes.js");

  await app.register(registerCapaRoutes);
  await app.register(registerEnforcementRoutes);
  await app.register(registerLicenceRoutes);
  await app.register(registerSurveyRoutes);
  await app.register(registerTelemetryRoutes);
  await app.register(registerFindingsRoutes);
  await app.register(registerUniverseRoutes);
  await app.register(registerRiskRoutes);
  await app.register(registerPlanningRoutes);
  await app.register(registerAssignmentRoutes);
  await app.register(registerChecklistRoutes);
  await app.register(registerSyncRoutes);
  await app.register(registerEvidenceRoutes);
  await app.register(registerExecutionRoutes);
  await app.register(registerDashboardRoutes);
  await app.register(registerReportsRoutes);
  await app.register(registerEncroachmentRoutes);
  await app.register(registerIllegalConstructionRoutes);

  return app;
}
