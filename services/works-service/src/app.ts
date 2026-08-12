import "./shared/bigint-json.js";
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

import { mastersRoutes } from "./modules/masters/routes.js";
import { proposalRoutes } from "./modules/proposal/routes.js";
import { approvalRoutes } from "./modules/approval/routes.js";
import { boqRoutes } from "./modules/boq/routes.js";
import { tenderRoutes } from "./modules/tender/routes.js";
import { executionRoutes } from "./modules/execution/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { reportingRoutes } from "./modules/reporting/routes.js";
import { contractorRoutes } from "./modules/contractor/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));

  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "works-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  registerSchemaErrorHandler(app, HttpError);

  // Module routes
  await app.register(mastersRoutes);
  await app.register(proposalRoutes);
  await app.register(approvalRoutes);
  await app.register(boqRoutes);
  await app.register(tenderRoutes);
  await app.register(executionRoutes);
  await app.register(billingRoutes);
  await app.register(reportingRoutes);
  await app.register(contractorRoutes);

  return app;
}
