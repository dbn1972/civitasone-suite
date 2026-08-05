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
import { leadFieldRuleRoutes } from "./modules/leads/field-rules-routes.js";
import { leadCaptureFormRoutes } from "./modules/leads/capture-forms-routes.js";
import { publicLeadCaptureRoutes } from "./modules/leads/public-routes.js";
import { qualificationRoutes } from "./modules/leads/qualification-routes.js";
import { leadScoreRuleRoutes } from "./modules/leads/score-rules-routes.js";
import { leadReasonCodeRoutes } from "./modules/leads/reason-codes-routes.js";
import { hierarchyRoutes } from "./modules/accounts/hierarchy-routes.js";
import { rolesRoutes } from "./modules/contacts/roles-routes.js";
import { identityRoutes } from "./modules/contacts/identity-routes.js";
import { dedupRoutes } from "./modules/contacts/dedup-routes.js";
import { mergeRoutes } from "./modules/contacts/merge-routes.js";
import { dataQualityRoutes } from "./modules/dashboard/data-quality-routes.js";
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
import { sentimentRoutes } from "./modules/sentiment/routes.js";
import { assignmentRoutes } from "./modules/assignment/routes.js";
import { communicationRoutes } from "./modules/communications/routes.js";
import { sendRoutes } from "./modules/communications/send-routes.js";
import { addressRoutes } from "./modules/addresses/routes.js";
import { accountRelationshipRoutes } from "./modules/accounts/relationships-routes.js";
import { integrationRoutes } from "./modules/integrations/routes.js";
import { threeSixtyRoutes } from "./modules/contacts/three-sixty-routes.js";
import { taskEscalationRuleRoutes } from "./modules/activities/task-escalation-routes.js";
import { stageLimitRoutes } from "./modules/deals/stage-limits-routes.js";
import { productRoutes } from "./modules/products/routes.js";
import { priceBookRoutes } from "./modules/price-books/routes.js";
import { quotationApprovalRoutes } from "./modules/deals/quotation-approval-routes.js";
import { documentRoutes } from "./modules/documents/routes.js";
import { documentTypeRoutes } from "./modules/documents/types-routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
    /**
     * Fastify's default is 100. That interacted badly with the PUBLIC lead-capture route
     * (LM-002): a `:formKey` longer than 100 characters did not MATCH the route at all, so
     * it fell to the not-found path and `authPlugin` — which cannot see `config.public` for
     * an unmatched route — answered 401 instead of the uniform 404 that route promises for
     * every malformed key. Raising the cap lets the route own the decision, and its own
     * anchored 64-hex `FORM_KEY_PATTERN` (and zod on every other route's params) is what
     * actually rejects an over-long value. Still bounded, so an absurd URL is cheap to
     * refuse.
     */
    maxParamLength: 512,
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
  // LM-001: per-tenant mandatory/weighted lead fields, enforced on manual capture.
  await app.register(leadFieldRuleRoutes);
  // LM-002: admin CRUD over the public form registry (crm_admin / tenant_admin / super_admin).
  await app.register(leadCaptureFormRoutes);
  // LM-002: the ONE unauthenticated write in this service. Registered last among the
  // lead routes and kept in its own file so the whole anonymous surface is auditable in
  // one place — see public-routes.ts for the threat model.
  await app.register(publicLeadCaptureRoutes);
  // LQ-001/002/004: qualification frameworks, configurable scoring + history,
  // lifecycle reason-code catalog.
  await app.register(qualificationRoutes);
  await app.register(leadScoreRuleRoutes);
  await app.register(leadReasonCodeRoutes);
  await app.register(hierarchyRoutes);
  await app.register(rolesRoutes);
  await app.register(identityRoutes);
  // DQ-001/002/004: dedup config + duplicate-check, lead/account merge, DQ dashboard.
  await app.register(dedupRoutes);
  await app.register(mergeRoutes);
  await app.register(dataQualityRoutes);
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
  // P2-6: Voice-of-Customer reporting over scored interactions.
  await app.register(sentimentRoutes);
  await app.register(assignmentRoutes);
  // ── ACM: Activity/Follow-up + Account/Contact management ──
  await app.register(communicationRoutes);
  // CO-001: send / bulk-send communications via notification-service
  await app.register(sendRoutes);
  await app.register(addressRoutes);
  await app.register(accountRelationshipRoutes);
  await app.register(integrationRoutes);
  await app.register(threeSixtyRoutes);
  await app.register(taskEscalationRuleRoutes);
  // ── OP/QP: opportunity + product/pricing/quotation surfaces ──
  await app.register(stageLimitRoutes);
  await app.register(productRoutes);
  await app.register(priceBookRoutes);
  await app.register(quotationApprovalRoutes);
  // ── DM: Document & Attachment Management (BRD §7.12) ──
  await app.register(documentRoutes);
  await app.register(documentTypeRoutes);

  return app;
}
