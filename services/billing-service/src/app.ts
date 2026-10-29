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
import { plansRoutes } from "./modules/plans/routes.js";
import { subscriptionsRoutes } from "./modules/subscriptions/routes.js";
import { usageRoutes } from "./modules/usage/routes.js";
import { invoicesRoutes } from "./modules/invoices/routes.js";
import { invoiceOpsRoutes } from "./modules/invoice-ops/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { checkoutRoutes } from "./modules/payments/checkout-routes.js";
import { einvoiceRoutes } from "./modules/einvoice/routes.js";
import { revenueRoutes } from "./modules/revenue/routes.js";
import { gstnRoutes } from "./modules/gstn/routes.js";
import { gatewayRoutes } from "./modules/gateways/routes.js";
import { churnRoutes } from "./modules/churn/routes.js";

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

  // Per-user rate limiting (300 req/min keyed by actorId, ops paths excluded), same
  // shape as hrms/audit/admin-service. authPlugin is registered first so req.ctx is
  // populated. Webhook and checkout routes override this via route-level config.
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
  // authPlugin's earlier onRequest hook), not the client-supplied x-tenant-id
  // header. createTenantTxHook only enters AsyncLocalStorage when x-tenant-id is
  // present; token-based requests omit it, so without this the app.tenant_id GUC
  // stays unset and -- under fail-closed RLS -- reads return zero rows. Sourcing
  // tenantId from the verified token makes scopedRead()'s transaction set the GUC
  // so RLS enforces isolation on reads AND writes.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  // MUST run BEFORE any app.register(<routes>) below: Fastify encapsulated route contexts copy the
  // parent error handler when they are created, so a handler set after the routes only covered the
  // root context and every ZodError thrown inside a route module without its own handler surfaced
  // as a 500 (UAT API sweep 2026-10-29, same root cause as hrms #2361 / payroll af21c820e).
  // delegateFrameworkClientErrors: module-local handlers that map unknown errors to 500 still answer
  // Fastify's own 4xx (malformed JSON, empty JSON body, ...) with the shared 4xx envelope.
  registerSchemaErrorHandler(app, HttpError, { delegateFrameworkClientErrors: true });

  registerOpsRoutes(app, { service: "billing-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(plansRoutes);
  await app.register(subscriptionsRoutes);
  await app.register(usageRoutes);
  await app.register(invoicesRoutes);
  await app.register(invoiceOpsRoutes);
  await app.register(paymentsRoutes);
  await app.register(checkoutRoutes);
  await app.register(einvoiceRoutes);
  await app.register(revenueRoutes);
  await app.register(gstnRoutes);
  await app.register(gatewayRoutes);
  await app.register(churnRoutes);


  return app;
}
