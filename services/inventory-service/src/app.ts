import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { itemRoutes } from "./modules/items/routes.js";
import { storeRoutes } from "./modules/stores/routes.js";
import { movementRoutes } from "./modules/movements/routes.js";

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

  registerOpsRoutes(app, { service: "inventory-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(itemRoutes);
  await app.register(storeRoutes);
  await app.register(movementRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
