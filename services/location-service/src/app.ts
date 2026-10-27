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
import { locationRoutes } from "./modules/locations/routes.js";
import { hierarchyRoutes } from "./modules/hierarchy/routes.js";
import { jurisdictionRoutes } from "./modules/jurisdiction/routes.js";
import { geofenceRoutes } from "./modules/geofence/routes.js";
import { pincodeRoutes } from "./modules/pincode/routes.js";
import { geocodingRoutes } from "./modules/geocoding/routes.js";
import { routingRoutes } from "./modules/routing/routes.js";

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

  registerOpsRoutes(app, { service: "location-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(locationRoutes);
  await app.register(hierarchyRoutes);
  await app.register(jurisdictionRoutes);
  await app.register(geofenceRoutes);
  await app.register(pincodeRoutes);
  await app.register(geocodingRoutes);
  await app.register(routingRoutes);
  const { landRecordRoutes } = await import("./modules/land-records/routes.js");
  await app.register(landRecordRoutes);
  const { spatialRoutes } = await import("./modules/spatial/routes.js");
  await app.register(spatialRoutes);
  const { infrastructureRoutes } = await import("./modules/infrastructure/routes.js");
  await app.register(infrastructureRoutes);
  const { cadastralRoutes } = await import("./modules/cadastral/routes.js");
  await app.register(cadastralRoutes);
  const { spatialExchangeRoutes } = await import("./modules/spatial-exchange/routes.js");
  await app.register(spatialExchangeRoutes);
  const { roadNetworkRoutes } = await import("./modules/road-network/routes.js");
  await app.register(roadNetworkRoutes);
  const { mapLayerRoutes } = await import("./modules/map-layers/routes.js");
  await app.register(mapLayerRoutes);
  const { mapMarkerRoutes } = await import("./modules/map-markers/routes.js");
  await app.register(mapMarkerRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
