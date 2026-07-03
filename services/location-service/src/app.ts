import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { locationRoutes } from "./modules/locations/routes.js";
import { hierarchyRoutes } from "./modules/hierarchy/routes.js";
import { jurisdictionRoutes } from "./modules/jurisdiction/routes.js";
import { geofenceRoutes } from "./modules/geofence/routes.js";
import { pincodeRoutes } from "./modules/pincode/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "location-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(locationRoutes);
  await app.register(hierarchyRoutes);
  await app.register(jurisdictionRoutes);
  await app.register(geofenceRoutes);
  await app.register(pincodeRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
