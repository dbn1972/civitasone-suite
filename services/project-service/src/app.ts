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
import { projectRoutes }     from "./modules/project/routes.js";
import { schemeRoutes }      from "./modules/scheme/routes.js";
import { progressRoutes }    from "./modules/progress/routes.js";
import { utilisationRoutes } from "./modules/utilisation/routes.js";
import { geoRoutes }         from "./modules/geo/routes.js";
import { dashboardRoutes }   from "./modules/dashboard/routes.js";
import { evidenceRoutes }    from "./modules/evidence/routes.js";
import { boardIntakeRoutes } from "./modules/board-intake/routes.js";

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

  registerOpsRoutes(app, { service: "project-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(projectRoutes);
  await app.register(schemeRoutes);
  await app.register(progressRoutes);
  await app.register(utilisationRoutes);
  await app.register(geoRoutes);
  await app.register(dashboardRoutes);
  await app.register(evidenceRoutes);
  await app.register(boardIntakeRoutes);

  const { worldClassProjectRoutes } = await import("./modules/project/world-class-routes.js");
  await app.register(worldClassProjectRoutes);

  const { mockEliminationRoutes } = await import("./modules/project/mock-elimination-routes.js");
  await app.register(mockEliminationRoutes);

  const { schedulingRoutes } = await import("./modules/scheduling/routes.js");
  await app.register(schedulingRoutes);

  const { baselineRoutes } = await import("./modules/scheduling/baselines.js");
  await app.register(baselineRoutes);

  const { wbsRoutes } = await import("./modules/scheduling/wbs-routes.js");
  await app.register(wbsRoutes);

  const { delayForecastRoutes } = await import("./modules/delay-forecast/routes.js");
  await app.register(delayForecastRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
