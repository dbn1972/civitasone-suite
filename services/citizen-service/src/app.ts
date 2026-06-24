import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { portalRoutes }      from "./modules/portal/routes.js";
import { applicationRoutes } from "./modules/application/routes.js";
import { grievanceRoutes }   from "./modules/grievance/routes.js";
import { rtiRoutes }         from "./modules/rti/routes.js";
import { helpdeskRoutes }    from "./modules/helpdesk/routes.js";
import { analyticsRoutes }   from "./modules/analytics/routes.js";
import { escalationRoutes } from "./modules/escalation/routes.js";
import { slaRulesRoutes } from "./modules/sla-rules/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  // P0-6: fail-fast if CITIZEN_PII_KEY is absent/too short so we never boot fail-open.
  assertPiiKeyConfigured();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "citizen-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(portalRoutes);
  await app.register(applicationRoutes);
  await app.register(grievanceRoutes);
  await app.register(rtiRoutes);
  await app.register(helpdeskRoutes);
  await app.register(analyticsRoutes);
  await app.register(escalationRoutes);
  await app.register(slaRulesRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
