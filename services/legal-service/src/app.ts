import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);
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

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
