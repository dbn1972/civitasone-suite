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
import { productRoutes } from "./modules/products/routes.js";
import { rateRoutes } from "./modules/rates/routes.js";
import { eligibilityRoutes } from "./modules/eligibility/routes.js";
import { bundleRoutes } from "./modules/bundles/routes.js";
// Sprint 2 — PC-001..PC-008, QP-001, QP-002
import { productVersionRoutes } from "./modules/products/versions-routes.js";
import { productLifecycleRoutes } from "./modules/products/lifecycle-routes.js";
import { regulatoryRoutes } from "./modules/products/regulatory-routes.js";
import { availabilityV2Routes } from "./modules/products/availability-v2-routes.js";
import { crossSellRoutes } from "./modules/products/cross-sell-routes.js";
import { publicCatalogueRoutes } from "./modules/products/public-routes.js";
import { productClassificationRoutes } from "./modules/products/classification-routes.js";
import { rateExternalRefRoutes } from "./modules/rates/external-ref-routes.js";
import { bundleApprovalRoutes } from "./modules/bundles/approvals-routes.js";
import { priceBookRoutes } from "./modules/price-books/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // RLS enforcement — set app.tenant_id GUC per request
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "catalogue-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(productRoutes);
  await app.register(rateRoutes);
  await app.register(eligibilityRoutes);
  await app.register(bundleRoutes);

  // Sprint 2 route surface. Fastify's radix router resolves static segments ahead
  // of parametric ones, so `/products/versions/...`, `/rates/external-refs`,
  // `/price-books/resolve` and `/regulatory/expiring` are never captured as ids.
  await app.register(productVersionRoutes);      // PC-001
  await app.register(productLifecycleRoutes);    // PC-002
  await app.register(regulatoryRoutes);          // PC-003
  await app.register(availabilityV2Routes);      // PC-004
  await app.register(rateExternalRefRoutes);     // PC-005
  await app.register(bundleApprovalRoutes);      // PC-006
  await app.register(publicCatalogueRoutes);     // PC-007
  await app.register(crossSellRoutes);           // PC-008
  await app.register(productClassificationRoutes); // QP-001
  await app.register(priceBookRoutes);           // QP-002

  return app;
}
