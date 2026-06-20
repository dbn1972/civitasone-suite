import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { employeeRoutes }   from "./modules/employee/routes.js";
import { leaveRoutes }      from "./modules/leave/routes.js";
import { attendanceRoutes } from "./modules/attendance/routes.js";
import { recruitmentRoutes } from "./modules/recruitment/routes.js";
import { trainingRoutes }   from "./modules/training/routes.js";
import { dashboardRoutes }  from "./modules/dashboard/routes.js";
import { orgChartRoutes }   from "./modules/orgchart/routes.js";
import { appraisalRoutes }  from "./modules/appraisals/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "hrms-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(employeeRoutes);
  await app.register(leaveRoutes);
  await app.register(attendanceRoutes);
  await app.register(recruitmentRoutes);
  await app.register(trainingRoutes);
  await app.register(dashboardRoutes);
  await app.register(orgChartRoutes);
  await app.register(appraisalRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
