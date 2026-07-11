import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import { caseRegistryRoutes } from "./modules/case-registry/routes.js";
import { courtRegistryRoutes } from "./modules/court-registry/routes.js";
import { caseLifecycleRoutes } from "./modules/case-lifecycle/routes.js";
import { hearingRoutes } from "./modules/hearing/routes.js";
import { filingRoutes } from "./modules/filing/routes.js";
import { orderRoutes } from "./modules/order/routes.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";

/**
 * court-service Fastify application factory.
 *
 * Mirrors the established sibling-service shape (visitor / citizen / finance):
 *   1. fail-fast PII key assertion (never boot fail-open),
 *   2. structured Pino logger with a correlation-id request id,
 *   3. CORS + Keycloak auth plugin,
 *   4. per-request tenant transaction hook (sets the app.tenant_id GUC so
 *      PostgreSQL RLS enforces isolation even if an app-layer WHERE is missed),
 *   5. ops routes — /health (+/ready) DB+Redis+Queue readiness/liveness and
 *      /metrics (Prometheus) — provided by @civitasone/observability,
 *   6. module route registrations (added incrementally — see task 19.2),
 *   7. the standard error handler that maps HttpError → the standard envelope
 *      `{ error: { code, message, details?, correlationId } }` and collapses
 *      unhandled errors to a generic 500 (raw PG/Redis errors never leak).
 */
export async function buildApp(): Promise<FastifyInstance> {
  // Fail-fast if COURT_PII_KEY is absent/too short so we never boot fail-open
  // (party personal_email / personal_phone are PII-encrypted at rest).
  assertPiiKeyConfigured();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  // /health (+/ready) readiness+liveness over DB + Redis + Queue, and /metrics
  // (Prometheus: request rate, error rate, p50/p95/p99, cache/queue signals).
  registerOpsRoutes(app, { service: "court-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  // ─── Module route registrations ──────────────────────────────────────────
  // Added one per module as each is scaffolded, then fully wired in task 19.2
  // ("Wire app.ts with all module routes and middleware"). Keep registrations
  // in the same order as the design's module table so a missing one is obvious:
  //   case-registry, court-registry, cause-list, hearing, order, filing.
  await app.register(caseRegistryRoutes);
  await app.register(courtRegistryRoutes);
  await app.register(caseLifecycleRoutes);
  await app.register(hearingRoutes);
  await app.register(filingRoutes);
  await app.register(orderRoutes);
  // await app.register(courtRegistryRoutes);
  // await app.register(causeListRoutes);
  // await app.register(hearingRoutes);
  // await app.register(orderRoutes);
  // await app.register(filingRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
