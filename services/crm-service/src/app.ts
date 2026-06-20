import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { contactRoutes } from "./modules/contacts/routes.js";
import { dealRoutes } from "./modules/deals/routes.js";
import { activityRoutes } from "./modules/activities/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "crm-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(contactRoutes);
  await app.register(dealRoutes);
  await app.register(activityRoutes);
  await app.register(dashboardRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
