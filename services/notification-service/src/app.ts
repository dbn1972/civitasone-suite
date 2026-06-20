import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { templateRoutes } from "./modules/templates/routes.js";
import { deliveryRoutes } from "./modules/deliveries/routes.js";
import { channelRoutes } from "./modules/channels/routes.js";
import { alertRoutes } from "./modules/alerts/routes.js";
import { bulkRoutes } from "./modules/bulk/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);
  registerOpsRoutes(app, { service: "notification-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(templateRoutes);
  await app.register(deliveryRoutes);
  await app.register(channelRoutes);
  await app.register(alertRoutes);
  await app.register(bulkRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
