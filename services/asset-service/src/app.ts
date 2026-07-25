import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
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

  const { fleetRoutes } = await import("./modules/fleet/routes.js");
  await app.register(fleetRoutes);
  const { fleetDeviceRoutes } = await import("./modules/fleet-devices/routes.js");
  await app.register(fleetDeviceRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
