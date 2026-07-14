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
import { plansRoutes } from "./modules/plans/routes.js";
import { subscriptionsRoutes } from "./modules/subscriptions/routes.js";
import { usageRoutes } from "./modules/usage/routes.js";
import { invoicesRoutes } from "./modules/invoices/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { checkoutRoutes } from "./modules/payments/checkout-routes.js";
import { einvoiceRoutes } from "./modules/einvoice/routes.js";
import { revenueRoutes } from "./modules/revenue/routes.js";
import { gstnRoutes } from "./modules/gstn/routes.js";
import { gatewayRoutes } from "./modules/gateways/routes.js";
import { churnRoutes } from "./modules/churn/routes.js";

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

  registerOpsRoutes(app, { service: "billing-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(plansRoutes);
  await app.register(subscriptionsRoutes);
  await app.register(usageRoutes);
  await app.register(invoicesRoutes);
  await app.register(paymentsRoutes);
  await app.register(checkoutRoutes);
  await app.register(einvoiceRoutes);
  await app.register(revenueRoutes);
  await app.register(gstnRoutes);
  await app.register(gatewayRoutes);
  await app.register(churnRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
