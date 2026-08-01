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
import { contactRoutes } from "./modules/contacts/routes.js";
import { dealRoutes } from "./modules/deals/routes.js";
import { forecastRoutes } from "./modules/deals/forecast-route.js";
import { activityRoutes } from "./modules/activities/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { pipelineRoutes } from "./modules/pipelines/routes.js";
import { customFieldRoutes } from "./modules/custom-fields/routes.js";
import { leadScoreRoutes } from "./modules/leads/score-route.js";
import { inboundLeadRoutes } from "./modules/leads/inbound-routes.js";
import { completenessRoutes } from "./modules/leads/completeness-route.js";
import { lifecycleRoutes } from "./modules/leads/lifecycle-routes.js";
import { hierarchyRoutes } from "./modules/accounts/hierarchy-routes.js";
import { rolesRoutes } from "./modules/contacts/roles-routes.js";
import { identityRoutes } from "./modules/contacts/identity-routes.js";
import { conversionRoutes } from "./modules/contacts/conversion-routes.js";
import { closeRoutes } from "./modules/deals/close-routes.js";
import { teamRoutes } from "./modules/teams/routes.js";

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

  registerOpsRoutes(app, { service: "crm-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(contactRoutes);
  await app.register(dealRoutes);
  await app.register(forecastRoutes);
  await app.register(activityRoutes);
  await app.register(dashboardRoutes);
  await app.register(pipelineRoutes);
  await app.register(customFieldRoutes);
  await app.register(leadScoreRoutes);
  await app.register(inboundLeadRoutes);
  await app.register(completenessRoutes);
  await app.register(lifecycleRoutes);
  await app.register(hierarchyRoutes);
  await app.register(rolesRoutes);
  await app.register(identityRoutes);
  await app.register(conversionRoutes);
  await app.register(closeRoutes);
  await app.register(teamRoutes);

  return app;
}
