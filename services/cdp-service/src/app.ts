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
import { profileRoutes } from "./modules/profiles/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { eventRoutes } from "./modules/events/routes.js";
import { segmentRoutes } from "./modules/segments/routes.js";
import { stewardRoutes } from "./modules/steward/routes.js";
import { profileLineageRoutes } from "./modules/profiles/lineage-routes.js";
import { profileSummaryRoutes } from "./modules/profiles/summary-routes.js";
import { profileScoreRoutes } from "./modules/profiles/scores-routes.js";
import { identityProbabilisticRoutes } from "./modules/identity/probabilistic-routes.js";
import { identityDeviceRoutes } from "./modules/identity/device-routes.js";
import { eventTaxonomyRoutes } from "./modules/events/taxonomy-routes.js";
import { eventIngestRoutes } from "./modules/events/ingest-routes.js";
import { segmentComputeRoutes } from "./modules/segments/compute-routes.js";
import { stewardQualityRoutes } from "./modules/steward/quality-routes.js";
import { dsarRoutes } from "./modules/dsar/routes.js";
import { activationRoutes } from "./modules/activations/routes.js";
import { profileTemplateRoutes } from "./modules/profiles/template-routes.js";
import { identityPhoneticRoutes } from "./modules/identity/phonetic-routes.js";
import { eventTaxonomyVersionRoutes } from "./modules/events/taxonomy-version-routes.js";
import { identityVisitorRoutes } from "./modules/identity/visitor-routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // RLS enforcement — set app.tenant_id GUC per request
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "cdp-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(profileRoutes);
  await app.register(identityRoutes);
  await app.register(eventRoutes);
  await app.register(segmentRoutes);
  await app.register(stewardRoutes);

  // Sprint 2 (CDP-001…CDP-012)
  await app.register(profileLineageRoutes);        // CDP-001
  await app.register(identityProbabilisticRoutes); // CDP-002
  await app.register(eventIngestRoutes);           // CDP-003
  await app.register(eventTaxonomyRoutes);         // CDP-004
  await app.register(segmentComputeRoutes);        // CDP-005
  await app.register(identityDeviceRoutes);        // CDP-007
  await app.register(profileSummaryRoutes);        // CDP-008
  await app.register(profileScoreRoutes);          // CDP-009
  await app.register(stewardQualityRoutes);        // CDP-010
  await app.register(dsarRoutes);                  // CDP-011
  await app.register(activationRoutes);            // CDP-012

  // Bharat Sampark CR rows
  await app.register(profileTemplateRoutes);       // CR-CDP-01
  await app.register(identityPhoneticRoutes);      // CR-CDP-02
  await app.register(eventTaxonomyVersionRoutes);  // CR-CDP-03
  await app.register(identityVisitorRoutes);       // CR-CDP-04

  return app;
}
