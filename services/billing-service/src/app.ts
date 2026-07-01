import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "billing-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(plansRoutes);
  await app.register(subscriptionsRoutes);
  await app.register(usageRoutes);
  await app.register(invoicesRoutes);
  await app.register(paymentsRoutes);
  await app.register(checkoutRoutes);
  await app.register(einvoiceRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
