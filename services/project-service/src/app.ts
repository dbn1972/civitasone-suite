import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "project-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(projectRoutes);
  await app.register(schemeRoutes);
  await app.register(progressRoutes);
  await app.register(utilisationRoutes);
  await app.register(geoRoutes);
  await app.register(dashboardRoutes);
  await app.register(evidenceRoutes);

  const { worldClassProjectRoutes } = await import("./modules/project/world-class-routes.js");
  await app.register(worldClassProjectRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
