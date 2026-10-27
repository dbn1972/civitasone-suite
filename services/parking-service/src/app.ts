import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerRateLimit } from "@civitasone/rate-limit";
import { randomUUID } from "node:crypto";
import { facilityRoutes } from "./modules/facilities/routes.js";
import { passRoutes } from "./modules/passes/routes.js";
import { bookingRoutes } from "./modules/bookings/routes.js";
import { enforcementRoutes } from "./modules/enforcement/routes.js";

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

  // G2: RLS enforcement — source the RLS tenant from the AUTHENTICATED token
  // (req.ctx, populated by authPlugin's earlier onRequest hook), not just the
  // client-supplied x-tenant-id header. createTenantTxHook only enters
  // AsyncLocalStorage when x-tenant-id is present; a spoofed header would
  // otherwise let an authenticated caller read/write another tenant's rows.
  // Header remains the fallback; the verified JWT tenant wins when present.
  // Mirrors admin-service / hrms-service / payroll-service.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, {
    service: "parking-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(facilityRoutes);
  await app.register(passRoutes);
  await app.register(bookingRoutes);
  await app.register(enforcementRoutes);

  return app;
}
