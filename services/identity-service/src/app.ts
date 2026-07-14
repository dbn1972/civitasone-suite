import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { randomUUID } from "node:crypto";
import { HttpError } from "./shared/context.js";
import { userRoutes } from "./modules/users/routes.js";
import { rbacRoutes } from "./modules/rbac/routes.js";
import { sessionRoutes } from "./modules/sessions/routes.js";
import { mfaRoutes } from "./modules/mfa/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { syncRoutes } from "./modules/sync/routes.js";
import { apiKeyRoutes } from "./modules/apikeys/routes.js";
import { breakGlassRoutes } from "./modules/breakglass/routes.js";
import { samlRoutes } from "./modules/saml/routes.js";
import { scimRoutes } from "./modules/scim/routes.js";
import { webauthnRoutes } from "./modules/webauthn/routes.js";

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

  // Source the RLS tenant from the AUTHENTICATED token (req.ctx, populated by
  // authPlugin earlier onRequest hook), not the client-supplied x-tenant-id
  // header. createTenantTxHook only enters AsyncLocalStorage when x-tenant-id is
  // present; token-based requests omit it, so without this the app.tenant_id GUC
  // stays unset and -- under a NOBYPASSRLS role + FORCE ROW LEVEL SECURITY -- the
  // fail-closed policy returns zero rows on reads. Sourcing tenantId from the
  // verified token makes scopedRead transaction set the GUC so RLS enforces
  // isolation on reads AND writes. Mirrors meeting-service.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "identity-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(userRoutes);
  await app.register(rbacRoutes);
  await app.register(sessionRoutes);
  await app.register(mfaRoutes);
  await app.register(deviceRoutes);
  await app.register(syncRoutes);
  await app.register(apiKeyRoutes);
  await app.register(breakGlassRoutes);
  await app.register(samlRoutes);
  await app.register(scimRoutes);
  await app.register(webauthnRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
