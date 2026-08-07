import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, getCurrentTenantId, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
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
import { aiTriageRoutes } from "./modules/ai/routes.js";
import { citizenRoutingRoutes } from "./modules/routing/routes.js";
import { eligibilityRoutes } from "./modules/eligibility/routes.js";
import { feePaymentRoutes } from "./modules/fee-payment/routes.js";
import { issuanceRoutes } from "./modules/issuance/routes.js";
import { discoveryRoutes } from "./modules/discovery/routes.js";
import { catalogueRoutes } from "./modules/catalogue/routes.js";
import { packsRoutes } from "./modules/packs/routes.js";
import { intakeRoutes } from "./modules/application/intake-routes.js";
import { documentsRoutes } from "./modules/documents/routes.js";
import { appealRoutes } from "./modules/appeal/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  // P0-6: fail-fast if CITIZEN_PII_KEY is absent/too short so we never boot fail-open.
  assertPiiKeyConfigured();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));
  // #146 NOBYPASSRLS repair: createTenantTxHook only honours the x-tenant-id
  // header. Requests authenticated purely via a Bearer token (JWT `tid` claim,
  // resolved into req.ctx by authPlugin above) previously ran with NO tenant
  // ALS context, so wrapWithTenantGuc never set app.tenant_id — every RLS read
  // returned 0 rows and writes were rejected once citizen_svc lost BYPASSRLS.
  // Fall back to the authenticated context's tenantId (never overrides an
  // explicit x-tenant-id, which the hook above has already entered).
  app.addHook("onRequest", async (req) => {
    if (!getCurrentTenantId()) {
      const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
      if (tid) tenantStorage.enterWith({ tenantId: tid });
    }
  });

  registerOpsRoutes(app, { service: "citizen-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(portalRoutes);
  await app.register(applicationRoutes);
  await app.register(grievanceRoutes);
  await app.register(rtiRoutes);
  await app.register(helpdeskRoutes);
  await app.register(analyticsRoutes);
  await app.register(escalationRoutes);
  await app.register(slaRulesRoutes);
  await app.register(aiTriageRoutes);
  await app.register(citizenRoutingRoutes);
  await app.register(eligibilityRoutes);
  await app.register(feePaymentRoutes);
  await app.register(issuanceRoutes);
  await app.register(discoveryRoutes);
  await app.register(catalogueRoutes);
  await app.register(packsRoutes);
  await app.register(intakeRoutes);
  await app.register(documentsRoutes);
  await app.register(appealRoutes);
  const { citizenGapRoutes } = await import("./modules/gap/routes.js");
  await app.register(citizenGapRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
