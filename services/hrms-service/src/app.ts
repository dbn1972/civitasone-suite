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
import { leaveContextRoutes } from "./modules/leave/context-routes.js";
import { attendanceRoutes } from "./modules/attendance/routes.js";
import { recruitmentRoutes } from "./modules/recruitment/routes.js";
import { trainingRoutes }   from "./modules/training/routes.js";
import { dashboardRoutes }  from "./modules/dashboard/routes.js";
import { orgChartRoutes }   from "./modules/orgchart/routes.js";
import { appraisalRoutes }  from "./modules/appraisals/routes.js";
import { internalRoutes }   from "./modules/internal/routes.js";
import { holidayRoutes } from "./modules/holidays/routes.js";
import { leaveTypesReadRoutes } from "./modules/leave/leave-types-route.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { bulkImportRoutes } from "./modules/bulk-import/routes.js";
import { selfServiceRoutes } from "./modules/self-service/routes.js";
import { policyAdminRoutes } from "./modules/leave/policy-admin-routes.js";
import { geoAttendanceRoutes } from "./modules/geo-attendance/routes.js";
import { faceVerificationRoutes } from "./modules/face-verification/routes.js";
import { aiFraudRoutes } from "./modules/ai-fraud/routes.js";
import { interviewRoutes } from "./modules/recruitment/interview-routes.js";
import { leaveCancelRoutes } from "./modules/leave/cancel-route.js";
import { compOffRoutes } from "./modules/leave/comp-off-routes.js";
import { fnfRoutes } from "./modules/employee/fnf-route.js";
import { lifecycleRoutes } from "./modules/lifecycle/routes.js";
import { serviceBookRoutes } from "./modules/service-book/routes.js";
import { pensionRoutes } from "./modules/pension/routes.js";
import { aparRoutes } from "./modules/apar/routes.js";
import { seniorityRoutes } from "./modules/seniority/routes.js";
import { gpfRoutes } from "./modules/gpf/routes.js";

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
  await app.register(leaveContextRoutes);
  await app.register(attendanceRoutes);
  await app.register(recruitmentRoutes);
  await app.register(trainingRoutes);
  await app.register(dashboardRoutes);
  await app.register(orgChartRoutes);
  await app.register(appraisalRoutes);
  await app.register(internalRoutes);
  await app.register(holidayRoutes);
  await app.register(leaveTypesReadRoutes);
  await app.register(reportRoutes);
  await app.register(bulkImportRoutes);
  await app.register(selfServiceRoutes);
  await app.register(policyAdminRoutes);
  await app.register(geoAttendanceRoutes);
  await app.register(faceVerificationRoutes);
  await app.register(aiFraudRoutes);
  await app.register(interviewRoutes);
  await app.register(leaveCancelRoutes);
  await app.register(compOffRoutes);
  await app.register(fnfRoutes);
  await app.register(lifecycleRoutes);
  await app.register(serviceBookRoutes);
  await app.register(pensionRoutes);
  await app.register(aparRoutes);
  await app.register(seniorityRoutes);
  await app.register(gpfRoutes);
  await app.register((await import("./modules/service-book/pdf-routes.js")).serviceBookPdfRoutes);
  await app.register((await import("./modules/pay-matrix/routes.js")).payMatrixRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
