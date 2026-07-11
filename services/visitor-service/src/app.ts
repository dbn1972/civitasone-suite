import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";

// NOTE: module routes below are added incrementally as each module is
// scaffolded (tasks 3.4, 4.7, 6.10, 7.5, 9.9, 11.5, 12.6, 13.5, 15.7, 16.4,
// 17.2, 20.4, 21.2). Uncomment/add the import + `await app.register(...)`
// call for a module once its `modules/{module}/routes.ts` exists — keep the
// list in the same order as the design's module table so it's easy to spot
// a missing registration.
//
import { locationRoutes }      from "./modules/location/routes.js";
import { blacklistRoutes }     from "./modules/blacklist/routes.js";
import { visitRequestRoutes }  from "./modules/visit-request/routes.js";
import { digitalPassRoutes }   from "./modules/digital-pass/routes.js";
import { checkInRoutes }       from "./modules/check-in/routes.js";
import { identityRoutes }      from "./modules/identity/routes.js";
import { groupVisitRoutes }    from "./modules/group-visit/routes.js";
import { recurringPassRoutes } from "./modules/recurring-pass/routes.js";
import { materialPassRoutes }  from "./modules/material-pass/routes.js";
import { vehiclePassRoutes }   from "./modules/vehicle-pass/routes.js";
import { evacuationRoutes }    from "./modules/evacuation/routes.js";
import { vipRoutes }           from "./modules/vip/routes.js";
import { analyticsRoutes }     from "./modules/analytics/routes.js";
import { dpdpRoutes }          from "./modules/dpdp/routes.js";
import deviceRegistryRoutes    from "./modules/device-registry/routes.js";
import badgePrintRoutes        from "./modules/badge-print/routes.js";
import documentScanRoutes      from "./modules/document-scan/routes.js";
import turnstileControlRoutes  from "./modules/turnstile-control/routes.js";
import { configRegistryRoutes } from "./modules/config-registry/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  // Fail-fast if VISITOR_PII_KEY is absent/too short so we never boot fail-open
  // (name, phone, email, aadhaar, photo_ref, address are all PII-encrypted).
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

  // Visitor-service hardening: source the RLS tenant from the AUTHENTICATED
  // token (req.ctx, populated by authPlugin earlier), NOT the client-supplied
  // x-tenant-id header. The header-based hook above is spoofable; the verified
  // JWT must win. Sets the app.tenant_id GUC (via AsyncLocalStorage) for
  // token-based requests so RLS enforces isolation on reads AND writes.
  // Mirrors court-service / meeting-service (commit 904c302).
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "visitor-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  // Module route registrations — added one per module as each is scaffolded.
  await app.register(locationRoutes);
  await app.register(blacklistRoutes);
  await app.register(visitRequestRoutes);
  await app.register(digitalPassRoutes);
  await app.register(checkInRoutes);
  await app.register(identityRoutes);
  await app.register(groupVisitRoutes);
  await app.register(recurringPassRoutes);
  await app.register(materialPassRoutes);
  await app.register(vehiclePassRoutes);
  await app.register(evacuationRoutes);
  await app.register(vipRoutes);
  await app.register(analyticsRoutes);
  await app.register(dpdpRoutes);
  await app.register(deviceRegistryRoutes);
  await app.register(badgePrintRoutes);
  await app.register(documentScanRoutes);
  await app.register(turnstileControlRoutes);
  await app.register(configRegistryRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
