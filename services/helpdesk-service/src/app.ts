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
import { ticketRoutes } from "./modules/tickets/routes.js";
import { notesRoutes } from "./modules/tickets/notes-routes.js";
import { linksRoutes } from "./modules/tickets/links-routes.js";
import { transferRoutes } from "./modules/tickets/transfer-routes.js";
import { bulkRoutes } from "./modules/tickets/bulk-routes.js";
import { slaRoutes } from "./modules/sla/routes.js";
import { automationRoutes } from "./modules/automation/routes.js";
import { mlBreachRoutes } from "./modules/ml-breach/routes.js";
import { catalogueRoutes } from "./modules/catalogue/routes.js";
import { categoriesRoutes } from "./modules/config/categories-routes.js";
import { statusesRoutes } from "./modules/config/statuses-routes.js";
import { dispositionsRoutes } from "./modules/config/dispositions-routes.js";
import { routingRoutes } from "./modules/routing/index.js";
import { calendarRoutes } from "./modules/sla/calendar-routes.js";
import { viewsRoutes } from "./modules/tickets/views-routes.js";
import { knowledgeRoutes } from "./modules/knowledge/routes.js";
import { sanitationRoutes } from "./modules/sanitation/routes.js";
import { roadHotspotRoutes } from "./modules/road-hotspot/routes.js";
import { cannedResponsesRoutes } from "./modules/canned-responses/routes.js";

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

  // #146 regression fix: also derive the tenant context from the AUTHENTICATED
  // principal (req.ctx.tenantId, set by authPlugin from the verified JWT tid).
  // createTenantTxHook only reads the OPTIONAL x-tenant-id header, so a write
  // route reached with a valid JWT but no header ran without the tenant GUC and
  // was rejected by FORCE RLS under the NOBYPASSRLS service role (HTTP 500).
  // Registered after createTenantTxHook so the authenticated tid wins; the
  // header remains the fallback for callers that send it (e.g. the gateway).
  app.addHook("onRequest", async (req) => {
    const tid = (req as typeof req & { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  // MUST be registered BEFORE any app.register(<routes>): Fastify encapsulated route contexts copy the
  // parent error handler at creation, so a handler set afterwards only covered the root context and
  // every ZodError / FastifyError thrown inside a route module became a 500 (UAT API sweep 2026-10-28).
  registerSchemaErrorHandler(app, HttpError, { delegateFrameworkClientErrors: true });

  registerOpsRoutes(app, { service: "helpdesk-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(ticketRoutes);
  await app.register(notesRoutes);
  await app.register(linksRoutes);
  await app.register(transferRoutes);
  await app.register(bulkRoutes);
  await app.register(slaRoutes);
  await app.register(automationRoutes);
  await app.register(mlBreachRoutes);
  await app.register(catalogueRoutes);
  await app.register(categoriesRoutes);
  await app.register(statusesRoutes);
  await app.register(dispositionsRoutes);
  await app.register(routingRoutes);
  await app.register(calendarRoutes);
  await app.register(viewsRoutes);
  await app.register(knowledgeRoutes);
  await app.register(roadHotspotRoutes);
  await app.register(sanitationRoutes);
  await app.register(cannedResponsesRoutes);
  const { slaEngineRoutes } = await import("./modules/sla-engine/routes.js");
  await app.register(slaEngineRoutes);

  return app;
}
