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
import { caseRoutes } from "./modules/cases/routes.js";
import { hearingRoutes } from "./modules/hearings/routes.js";
import { noticeRoutes } from "./modules/notices/routes.js";
import { contractRoutes } from "./modules/contracts/routes.js";
import { settlementRoutes } from "./modules/settlements/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { reminderRoutes } from "./modules/reminders/routes.js";
import { opinionRoutes } from "./modules/opinions/routes.js";
import { counselBriefRoutes } from "./modules/counsel/routes.js";
import { filingRoutes } from "./modules/filings/routes.js";
import { ecourtsRoutes } from "./modules/ecourts/routes.js";
import { documentRoutes } from "./modules/documents/routes.js";
import { limitationRoutes } from "./modules/limitations/routes.js";
import { intelligenceRoutes } from "./modules/intelligence/routes.js";
import { boardIntakeRoutes } from "./modules/board-intake/routes.js";
import { rtiRoutes } from "./modules/rti/routes.js";

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

  registerOpsRoutes(app, { service: "legal-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(caseRoutes);
  await app.register(hearingRoutes);
  await app.register(noticeRoutes);
  await app.register(contractRoutes);
  await app.register(settlementRoutes);
  await app.register(dashboardRoutes);
  await app.register(reminderRoutes);
  await app.register(opinionRoutes);
  await app.register(counselBriefRoutes);
  await app.register(filingRoutes);
  await app.register(ecourtsRoutes);
  await app.register(documentRoutes);
  await app.register(limitationRoutes);
  await app.register(intelligenceRoutes);
  await app.register(boardIntakeRoutes);
  await app.register(rtiRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
