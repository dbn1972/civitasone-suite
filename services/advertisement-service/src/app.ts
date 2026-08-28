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
import { applicationRoutes } from "./modules/applications/routes.js";
import { approvalRoutes } from "./modules/approvals/routes.js";
import { permitRoutes } from "./modules/permits/routes.js";
import { enforcementRoutes } from "./modules/enforcement/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, {
    service: "advertisement-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(applicationRoutes);
  await app.register(approvalRoutes);
  await app.register(permitRoutes);
  await app.register(enforcementRoutes);

  return app;
}
