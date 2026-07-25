import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { roleRoutes } from "./modules/roles/routes.js";
import { bindingRoutes } from "./modules/bindings/routes.js";
import { evaluateRoutes } from "./modules/evaluate/routes.js";
import { abacRoutes } from "./modules/abac/routes.js";
import { roleFeatureRoutes } from "./modules/role-features/routes.js";

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
  // authPlugin's earlier onRequest hook), not the client-supplied x-tenant-id
  // header. createTenantTxHook only enters AsyncLocalStorage when x-tenant-id is
  // present; token-based requests omit it, so without this the app.tenant_id GUC
  // stays unset and -- under the NOBYPASSRLS policy_svc role (#146) with
  // fail-closed RLS -- reads return zero rows and outbox writes are rejected.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "policy-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(roleRoutes);
  await app.register(bindingRoutes);
  await app.register(evaluateRoutes);
  await app.register(abacRoutes);
  await app.register(roleFeatureRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
