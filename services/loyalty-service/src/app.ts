import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { HttpError } from "./shared/context.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { programRoutes } from "./modules/programs/routes.js";
import { enrolmentRoutes } from "./modules/enrolments/routes.js";
import { accrualRoutes } from "./modules/accruals/routes.js";
import { redemptionRoutes } from "./modules/redemptions/routes.js";
import { tierRoutes } from "./modules/tiers/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, {
    service: "loyalty-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });

  registerSchemaErrorHandler(app, HttpError);

  await app.register(programRoutes);
  await app.register(enrolmentRoutes);
  await app.register(accrualRoutes);
  await app.register(redemptionRoutes);
  await app.register(tierRoutes);

  return app;
}
