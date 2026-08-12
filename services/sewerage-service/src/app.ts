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
import { connectionRoutes } from "./modules/connections/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { complaintRoutes } from "./modules/complaints/routes.js";
import { desludgingRoutes } from "./modules/desludging/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "sewerage-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(connectionRoutes);
  await app.register(billingRoutes);
  await app.register(complaintRoutes);
  await app.register(desludgingRoutes);

  return app;
}
