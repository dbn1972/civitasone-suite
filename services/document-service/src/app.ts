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
import { fileRoutes }    from "./modules/files/routes.js";
import { folderRoutes }  from "./modules/folders/routes.js";
import { workflowRoutes } from "./modules/workflow/routes.js";
import { sharingRoutes } from "./modules/sharing/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "document-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(fileRoutes);
  await app.register(folderRoutes);
  await app.register(workflowRoutes);
  await app.register(sharingRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
