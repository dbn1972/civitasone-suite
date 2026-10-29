import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { registerRateLimit } from "@civitasone/rate-limit";
import { randomUUID } from "node:crypto";
import { HttpError } from "./shared/context.js";
import { userRoutes } from "./modules/users/routes.js";
import { userInternalRoutes } from "./modules/users/internal-routes.js";
import { rbacRoutes } from "./modules/rbac/routes.js";
import { sessionRoutes } from "./modules/sessions/routes.js";
import { mfaRoutes } from "./modules/mfa/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { syncRoutes } from "./modules/sync/routes.js";
import { apiKeyRoutes } from "./modules/apikeys/routes.js";
import { apiKeyInternalRoutes } from "./modules/apikeys/internal-routes.js";
import { breakGlassRoutes } from "./modules/breakglass/routes.js";
import { samlRoutes } from "./modules/saml/routes.js";
import { securitySummaryRoutes } from "./modules/security-summary/routes.js";
import { scimRoutes, scimTokenRoutes } from "./modules/scim/routes.js";
import { webauthnRoutes } from "./modules/webauthn/routes.js";
import { operatorRoutes } from "./modules/operators/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // SEC: explicit request-body cap (1 MiB) -- bounds zod collection validation (GHSA-mrhx-c7xc-m3w5); guarded by scripts/ci/fastify-bodylimit-guard.mjs
    bodyLimit: 1_048_576,
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

  // CodeQL js/missing-rate-limiting: register rate-limit plugin so per-route
  // config { config: { rateLimit: { max, timeWindow } } } is honoured.
  await registerRateLimit(app);

  // MUST run BEFORE any app.register(<routes>) below: Fastify encapsulated route contexts copy the
  // parent error handler when they are created, so a handler set after the routes only covered the
  // root context and every ZodError thrown inside a route module without its own handler (sessions,
  // sync, devices, saml, scim-tokens, webauthn) surfaced as a 500 (UAT API sweep 2026-10-29; same root
  // cause as hrms #2361). delegateFrameworkClientErrors: module-local handlers that map unknown errors
  // to 500 still answer Fastify's own 4xx (malformed JSON, empty JSON body, ...) with the shared envelope.
  registerSchemaErrorHandler(app, HttpError, { delegateFrameworkClientErrors: true });

  registerOpsRoutes(app, { service: "identity-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(userRoutes);
  await app.register(userInternalRoutes);
  await app.register(rbacRoutes);
  await app.register(sessionRoutes);
  await app.register(mfaRoutes);
  await app.register(deviceRoutes);
  await app.register(syncRoutes);
  await app.register(apiKeyRoutes);
  // SEC-024: gateway-only api-key verify -- see internal-routes.ts.
  await app.register(apiKeyInternalRoutes);
  await app.register(breakGlassRoutes);
  await app.register(samlRoutes);
  await app.register(securitySummaryRoutes);
  await app.register(scimRoutes);
  await app.register(scimTokenRoutes);
  await app.register(webauthnRoutes);
  await app.register(operatorRoutes);

  const { govIntegrationRoutes } = await import("./modules/gov-integrations/routes.js");
  await app.register(govIntegrationRoutes);

  return app;
}
