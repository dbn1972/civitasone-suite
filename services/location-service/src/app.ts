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
import { locationRoutes } from "./modules/locations/routes.js";
import { hierarchyRoutes } from "./modules/hierarchy/routes.js";
import { jurisdictionRoutes } from "./modules/jurisdiction/routes.js";
import { geofenceRoutes } from "./modules/geofence/routes.js";
import { pincodeRoutes } from "./modules/pincode/routes.js";
import { geocodingRoutes } from "./modules/geocoding/routes.js";
import { routingRoutes } from "./modules/routing/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
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
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
