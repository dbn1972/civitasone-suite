import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerRateLimit } from "@civitasone/rate-limit";
import { randomUUID } from "node:crypto";
import { nbaRoutes } from "./modules/nba/routes.js";
import { nbaRankingRoutes } from "./modules/nba/ranking-routes.js";
import { matrixRoutes } from "./modules/matrix/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { healthScoringRoutes } from "./modules/health/scoring-routes.js";
import { feedbackRoutes } from "./modules/feedback/routes.js";
import { feedbackReasonRoutes } from "./modules/feedback/reason-routes.js";
import { predictiveRoutes } from "./modules/predictive/routes.js";
import { collateralRoutes } from "./modules/collateral/routes.js";
import { intelligenceRoutes } from "./modules/intelligence/routes.js";
import { triggerRoutes } from "./modules/triggers/routes.js";
import { measurementRoutes } from "./modules/measurement/routes.js";

// Trust X-Forwarded-For only from internal peers (gateway / web tier), so req.ip is the real client and an
// external caller cannot forge it. Same value as hrms-service INTERNAL_PROXY_TRUST. Deliberately not `true`.
const INTERNAL_PROXY_TRUST = "loopback,linklocal,uniquelocal";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // SEC: explicit request-body cap (1 MiB) -- bounds zod collection validation (GHSA-mrhx-c7xc-m3w5); guarded by scripts/ci/fastify-bodylimit-guard.mjs
    bodyLimit: 1_048_576,
    trustProxy: INTERNAL_PROXY_TRUST,
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // Per-user rate limiting (300 req/min keyed by actorId, ops paths excluded), same shape as
  // hrms/billing/audit-service. authPlugin is registered first so req.ctx is populated.
  await registerRateLimit(app, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req as { ctx?: { actorId?: string } }).ctx?.actorId ?? req.ip ?? "anonymous",
    skip: (req) => (req.url ?? "").startsWith("/health") || (req.url ?? "").startsWith("/ready") || (req.url ?? "").startsWith("/metrics"),
  });

  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "recommendation-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  // Static-path plugins are registered before their parametric siblings so the
  // intent is obvious in one place (find-my-way prefers static regardless).
  await app.register(predictiveRoutes);
  await app.register(collateralRoutes);
  await app.register(intelligenceRoutes);
  await app.register(measurementRoutes);
  await app.register(triggerRoutes);
  await app.register(feedbackReasonRoutes);
  await app.register(healthScoringRoutes);
  await app.register(nbaRankingRoutes);

  await app.register(nbaRoutes);
  await app.register(matrixRoutes);
  await app.register(healthRoutes);
  await app.register(feedbackRoutes);

  return app;
}
