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
import { itemRoutes }      from "./modules/item/routes.js";
import { warehouseRoutes } from "./modules/warehouse/routes.js";
import { entryRoutes }     from "./modules/entry/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { ewayBillRoutes }  from "./modules/eway-bill/routes.js";
import { proxyRoutes }     from "./modules/proxy/routes.js";

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

  registerOpsRoutes(app, { service: "stock-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  // Deprecation notice: all /v1/stock/* routes are deprecated.
  // Clients should migrate to inventory-service /v1/inventory/* endpoints.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/v1/stock/")) {
      reply.header("Deprecation", "true");
      reply.header("Sunset", "2026-10-01");
      reply.header("Link", '</v1/inventory/>; rel="successor-version"');
    }
  });


  // Native routes kept for stock-specific functionality
  await app.register(dashboardRoutes);
  await app.register(ewayBillRoutes);

  // Deprecation proxy: /v1/stock/items, /v1/stock/warehouses, /v1/stock/entries,
  // /v1/stock/ledger, /v1/stock/valuation now forward to inventory-service.
  // The canonical data model lives in inventory-service (Req 14.1).
  // Original native routes for items/warehouses/entries are superseded by proxies.
  await app.register(itemRoutes);
  await app.register(warehouseRoutes);
  await app.register(entryRoutes);
  await app.register(proxyRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
