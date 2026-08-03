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
import { planRoutes } from "./modules/accounts/plans-routes.js";
import { qbrRoutes } from "./modules/accounts/qbr-routes.js";
import { tenderRoutes } from "./modules/deals/tenders-routes.js";
import { quotationRoutes } from "./modules/deals/quotations-routes.js";
import { nextActionRoutes } from "./modules/activities/next-action-routes.js";
import { captureRoutes } from "./modules/activities/capture-routes.js";
import { recurringTaskRoutes } from "./modules/activities/recurring-routes.js";
import { campaignRoiRoutes } from "./modules/dashboard/campaign-roi-routes.js";
import { onboardingRoutes } from "./modules/onboarding/routes.js";

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
  // Sprint 2: key-account planning, tenders, QBRs, next actions, activity
  // capture, recurring tasks, quotations, campaign ROI.
  await app.register(planRoutes);
  await app.register(qbrRoutes);
  await app.register(tenderRoutes);
  await app.register(quotationRoutes);
  await app.register(nextActionRoutes);
  await app.register(captureRoutes);
  await app.register(recurringTaskRoutes);
  await app.register(campaignRoiRoutes);
  // P1-9: customer onboarding raised on a won deal, gated on KYC verification.
  await app.register(onboardingRoutes);

  return app;
}
