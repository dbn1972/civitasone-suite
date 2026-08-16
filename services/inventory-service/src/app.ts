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
import { itemRoutes } from "./modules/items/routes.js";
import { storeRoutes } from "./modules/stores/routes.js";
import { warehouseRoutes } from "./modules/warehouses/routes.js";
import { movementRoutes } from "./modules/movements/routes.js";
import { batchRoutes } from "./modules/batches/routes.js";
import { cycleCountRoutes } from "./modules/cycle-count/routes.js";
import { matchingRoutes } from "./modules/matching/routes.js";
import { forecastRoutes } from "./modules/forecast/routes.js";
import { custodianRoutes } from "./modules/custodians/routes.js";
import { srnRoutes } from "./modules/srn/routes.js";

/**
 * inventory-service HTTP app — government store/inventory domain.
 * CQRS: routes enqueue commands; the worker (src/worker.ts) consumes them.
 */
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

  registerOpsRoutes(app, { service: "inventory-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(itemRoutes);
  await app.register(storeRoutes);
  await app.register(warehouseRoutes);
  await app.register(movementRoutes);
  await app.register(batchRoutes);
  await app.register(cycleCountRoutes);
  await app.register(matchingRoutes);
  await app.register(forecastRoutes);
  await app.register(custodianRoutes);
  await app.register(srnRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
