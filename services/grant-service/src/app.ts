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
import { schemeRoutes }        from "./modules/scheme/routes.js";
import { applicationRoutes }   from "./modules/application/routes.js";
import { disbursementRoutes }  from "./modules/disbursement/routes.js";
import { utilisationRoutes }   from "./modules/utilisation/routes.js";
import { beneficiaryRoutes }   from "./modules/beneficiary/routes.js";
import { dashboardRoutes }     from "./modules/dashboard/routes.js";
import { ucValidationRoutes }  from "./modules/uc-validation/routes.js";

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

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "grant-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(schemeRoutes);
  await app.register(applicationRoutes);
  await app.register(disbursementRoutes);
  await app.register(utilisationRoutes);
  await app.register(beneficiaryRoutes);
  await app.register(dashboardRoutes);
  await app.register(ucValidationRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
