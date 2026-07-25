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
import { employeeRoutes }   from "./modules/employee/routes.js";
import { leaveRoutes }      from "./modules/leave/routes.js";
import { leaveContextRoutes } from "./modules/leave/context-routes.js";
import { attendanceRoutes } from "./modules/attendance/routes.js";
import { recruitmentRoutes, publicRecruitmentRoutes } from "./modules/recruitment/routes.js";
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
import { deputationRoutes } from "./modules/deputation/routes.js";
import { claimsRoutes } from "./modules/claims/routes.js";
import { schedulerRoutes } from "./modules/scheduler/routes.js";
import { disciplinaryRoutes } from "./modules/disciplinary/routes.js";
import { reservationRoutes } from "./modules/reservation/routes.js";
import { rtiRoutes } from "./modules/rti/routes.js";
import { socialRoutes } from "./modules/social/routes.js";
import { pulseGoalsRoutes } from "./modules/social/pulse-routes.js";
import { idCardRoutes } from "./modules/id-cards/routes.js";
import { visitingCardRoutes } from "./modules/visiting-cards/routes.js";
import { deviceTrustRoutes } from "./modules/device-trust/routes.js";
import { boardIntakeRoutes } from "./modules/board-intake/routes.js";
import { assessmentRoutes } from "./modules/assessment/routes.js";
import { trainingAdminRoutes } from "./modules/training-admin/routes.js";
import { learningRoutes } from "./modules/learning/routes.js";
import { competencyRoutes } from "./modules/competency/routes.js";
import { contractRoutes } from "./modules/contracts/routes.js";
import { integrationRoutes } from "./modules/integration/routes.js";

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

  registerOpsRoutes(app, { service: "hrms-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(employeeRoutes);
  await app.register(leaveRoutes);
  await app.register(leaveContextRoutes);
  await app.register(attendanceRoutes);
  await app.register(recruitmentRoutes);
  await app.register(publicRecruitmentRoutes);
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
  await app.register(deputationRoutes);
  await app.register(claimsRoutes);
  await app.register(schedulerRoutes);
  await app.register(disciplinaryRoutes);
  await app.register(reservationRoutes);
  await app.register(rtiRoutes);
  await app.register(socialRoutes);
  await app.register(pulseGoalsRoutes);
  await app.register(idCardRoutes);
  await app.register(visitingCardRoutes);
  await app.register(deviceTrustRoutes);
  await app.register(boardIntakeRoutes);
  await app.register(assessmentRoutes);
  await app.register(trainingAdminRoutes);
  await app.register(learningRoutes);
  await app.register(competencyRoutes);
  await app.register(contractRoutes);
  await app.register(integrationRoutes);
  const { manpowerPlanningRoutes } = await import("./modules/manpower-planning/routes.js");
  await app.register(manpowerPlanningRoutes);
  await app.register((await import("./modules/service-book/pdf-routes.js")).serviceBookPdfRoutes);
  await app.register((await import("./modules/pay-matrix/routes.js")).payMatrixRoutes);
  await app.register((await import("./modules/employee/masters-routes.js")).mastersRoutes);
  await app.register((await import("./modules/employee/employee-types-routes.js")).employeeTypeRoutes);
  await app.register((await import("./modules/employee/loans-routes.js")).loansRoutes);
  const { medicalClaimsRoutes } = await import("./modules/medical/routes.js");
  await app.register(medicalClaimsRoutes);
  const { workforcePlanningRoutes } = await import("./modules/workforce-planning/routes.js");
  await app.register(workforcePlanningRoutes);
  const { aiPredictionsRoutes } = await import("./modules/ai-predictions/routes.js");
  await app.register(aiPredictionsRoutes);
  const { faceVerificationMlRoutes } = await import("./modules/ai-ml/face-verification.js");
  await app.register(faceVerificationMlRoutes);
  const { documentOcrRoutes } = await import("./modules/ai-ml/document-ocr.js");
  await app.register(documentOcrRoutes);
  const { nluChatbotRoutes } = await import("./modules/ai-ml/nlu-chatbot.js");
  await app.register(nluChatbotRoutes);
  const { recruitmentAiRoutes } = await import("./modules/ai-ml/recruitment-ai.js");
  await app.register(recruitmentAiRoutes);
  const { aiPluginRegistryRoutes } = await import("./modules/ai-ml/plugin-registry.js");
  await app.register(aiPluginRegistryRoutes);
  const { hrmsGapRoutes } = await import("./modules/gap-features/routes.js");
  await app.register(hrmsGapRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
