import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { HttpError } from "./shared/context.js";
import { cycleRoutes, commandStatusRoutes } from "./modules/movement/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));

  // RLS tenant comes from the AUTHENTICATED token (req.ctx), not just the
  // client-supplied x-tenant-id header — a spoofed header must not let a caller
  // reach another tenant's rows. The verified JWT tenant wins when present.
  // Mirrors building-service / admin-service / hrms-service.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  // health + /ready (registerOpsRoutes provides both).
  registerOpsRoutes(app, {
    service: "smarttransfer-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(cycleRoutes);
  await app.register(commandStatusRoutes);

  return app;
}
