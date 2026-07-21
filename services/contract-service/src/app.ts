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
import { contractRoutes } from "./modules/contracts/routes.js";
import { rateRoutes }     from "./modules/rate/routes.js";
import { clauseRoutes }   from "./modules/clauses/routes.js";
import { versionRoutes }  from "./modules/versions/routes.js";
import { obligationRoutes } from "./modules/obligations/routes.js";
import { renewalRoutes }    from "./modules/renewals/routes.js";
import { approvalRoutes }   from "./modules/approvals/routes.js";
import { esignRoutes }      from "./modules/esign/routes.js";
import { templateRoutes }   from "./modules/templates/routes.js";

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

  // Also propagate tenantId into AsyncLocalStorage from req.ctx (set by authPlugin)
  // so that scopedRead/db.transaction auto-injects the GUC for bare reads/writes.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "contract-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(contractRoutes);
  await app.register(rateRoutes);
  await app.register(clauseRoutes);
  await app.register(versionRoutes);
  await app.register(obligationRoutes);
  await app.register(renewalRoutes);
  await app.register(approvalRoutes);
  await app.register(esignRoutes);
  await app.register(templateRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
