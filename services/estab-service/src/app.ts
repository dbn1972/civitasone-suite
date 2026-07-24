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
import { filesRoutes }     from "./modules/files/routes.js";
import { committeeRoutes } from "./modules/committee/routes.js";
import { assetsRoutes }    from "./modules/assets/routes.js";
import { facilitiesRoutes } from "./modules/facilities/routes.js";
import { legalRoutes }     from "./modules/legal/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { linkageRoutes }   from "./modules/linkage/routes.js";
import { approvalRulesRoutes } from "./modules/approval-rules/routes.js";
import { dfaRoutes }        from "./modules/dfa/routes.js";
import { handoverRoutes }   from "./modules/handover/routes.js";
import { migrationRoutes }  from "./modules/migration/routes.js";
import { operatorRoutes }   from "./modules/operators/routes.js";
import { referencingRoutes } from "./modules/referencing/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { correspondenceRoutes } from "./modules/correspondence/routes.js";
import { recordsRoutes } from "./modules/records/routes.js";
import { esignRoutes } from "./modules/esign/routes.js";
import { quartersRoutes } from "./modules/quarters/routes.js";
import { fleetRoutes } from "./modules/fleet/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "estab-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  // Uniform Zod + HTTP error envelope MUST be registered BEFORE the route
  // modules so each encapsulated child inherits it at load time (Fastify binds
  // the error handler at registration, not per-request). Registering it after
  // the routes — as before — left every child context on Fastify's default
  // handler, so ZodError validation failures leaked as raw 500s.
  registerSchemaErrorHandler(app, HttpError);

  await app.register(filesRoutes);
  await app.register(committeeRoutes);
  await app.register(assetsRoutes);
  await app.register(facilitiesRoutes);
  await app.register(legalRoutes);
  await app.register(dashboardRoutes);
  await app.register(linkageRoutes);
  await app.register(approvalRulesRoutes);
  await app.register(dfaRoutes);
  await app.register(handoverRoutes);
  await app.register(migrationRoutes);
  await app.register(operatorRoutes);
  await app.register(referencingRoutes);
  await app.register(notificationRoutes);
  await app.register(correspondenceRoutes);
  await app.register(recordsRoutes);
  await app.register(esignRoutes);
  await app.register(quartersRoutes);
  await app.register(fleetRoutes);

  return app;
}
