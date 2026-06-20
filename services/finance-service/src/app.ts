import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { budgetRoutes }   from "./modules/budget/routes.js";
import { glRoutes }       from "./modules/gl/routes.js";
import { treasuryRoutes } from "./modules/treasury/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "finance-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(budgetRoutes);
  await app.register(glRoutes);
  await app.register(treasuryRoutes);
  await app.register(paymentsRoutes);
  await app.register(dashboardRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
