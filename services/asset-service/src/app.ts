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
import { registerRoutes }    from "./modules/register/routes.js";
import { lifecycleRoutes }   from "./modules/lifecycle/routes.js";
import { depRoutes }         from "./modules/depreciation/routes.js";
import { maintenanceRoutes } from "./modules/maintenance/routes.js";
import { insuranceRoutes }   from "./modules/insurance/routes.js";
import { dashboardRoutes }   from "./modules/dashboard/routes.js";
import { verificationRoutes } from "./modules/verification/routes.js";
import { enterpriseRoutes } from "./modules/enterprise/routes.js";
import { condemnationRoutes } from "./modules/condemnation/routes.js";
import { waterConnectionRoutes } from "./modules/water-connections/routes.js";
import { waterMeteringRoutes } from "./modules/water-metering/routes.js";
import { waterTankerRoutes } from "./modules/water-tanker/routes.js";
import { streetlightRoutes } from "./modules/streetlight/routes.js";

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

  registerOpsRoutes(app, { service: "asset-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(registerRoutes);
  await app.register(lifecycleRoutes);
  await app.register(depRoutes);
  await app.register(maintenanceRoutes);
  await app.register(insuranceRoutes);
  await app.register(dashboardRoutes);
  await app.register(verificationRoutes);
  await app.register(enterpriseRoutes);
  await app.register(condemnationRoutes);
  await app.register(waterConnectionRoutes);
  await app.register(waterMeteringRoutes);
  await app.register(waterTankerRoutes);
  await app.register(streetlightRoutes);

  const { fleetRoutes } = await import("./modules/fleet/routes.js");
  await app.register(fleetRoutes);
  const { fleetDeviceRoutes } = await import("./modules/fleet-devices/routes.js");
  await app.register(fleetDeviceRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
