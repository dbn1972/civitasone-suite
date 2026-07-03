import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerEmployeeConsumers }   from "./modules/employee/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/lifecycle/eoffice-consumer.js";
import { registerPromotionEOfficeConsumers } from "./modules/lifecycle/promotion-eoffice-consumer.js";
import { registerDisciplinaryConsumers } from "./modules/disciplinary/consumer.js";
import { registerDisciplinaryEOfficeConsumers } from "./modules/disciplinary/eoffice-consumer.js";
import { registerLeaveSpecialEOfficeConsumers } from "./modules/leave/eoffice-consumer.js";
import { registerRecruitmentEOfficeConsumers } from "./modules/recruitment/eoffice-consumer.js";
import { registerLeaveConsumers }      from "./modules/leave/consumer.js";
import { registerAttendanceConsumers } from "./modules/attendance/consumer.js";
import { registerRecruitmentConsumers } from "./modules/recruitment/consumer.js";
import { registerTrainingConsumers }   from "./modules/training/consumer.js";
import { registerIntegrationConsumers } from "./modules/integration/consumer.js";
import { registerAppraisalConsumers }  from "./modules/appraisals/consumer.js";
// Previous batch consumers
import { registerAparConsumers }       from "./modules/apar/consumer.js";
import { registerClaimsConsumers }     from "./modules/claims/consumer.js";
import { registerDeputationConsumers } from "./modules/deputation/consumer.js";
import { registerGeoAttendanceConsumers } from "./modules/geo-attendance/consumer.js";
import { registerGpfConsumers }        from "./modules/gpf/consumer.js";
import { registerHolidayConsumers }    from "./modules/holidays/consumer.js";
import { registerIdCardConsumers }     from "./modules/id-cards/consumer.js";
import { registerMedicalConsumers }    from "./modules/medical/consumer.js";
import { registerPayMatrixConsumers }  from "./modules/pay-matrix/consumer.js";
import { registerPensionConsumers }    from "./modules/pension/consumer.js";
import { registerReservationConsumers } from "./modules/reservation/consumer.js";
import { registerSeniorityConsumers }  from "./modules/seniority/consumer.js";
import { registerServiceBookConsumers } from "./modules/service-book/consumer.js";
import { registerWorkforcePlanningConsumers } from "./modules/workforce-planning/consumer.js";
// Current batch consumers
import { registerAiFraudConsumers }    from "./modules/ai-fraud/consumer.js";
import { registerAiPredictionsConsumers } from "./modules/ai-predictions/consumer.js";
import { registerBulkImportConsumers } from "./modules/bulk-import/consumer.js";
import { registerDashboardConsumers }  from "./modules/dashboard/consumer.js";
import { registerDeviceTrustConsumers } from "./modules/device-trust/consumer.js";
import { registerFaceVerificationConsumers } from "./modules/face-verification/consumer.js";
import { registerInternalConsumers }   from "./modules/internal/consumer.js";
import { registerOrgchartConsumers }   from "./modules/orgchart/consumer.js";
import { registerReportsConsumers }    from "./modules/reports/consumer.js";
import { registerRtiConsumers }        from "./modules/rti/consumer.js";
import { registerSchedulerConsumers }  from "./modules/scheduler/consumer.js";
import { registerSelfServiceConsumers } from "./modules/self-service/consumer.js";
import { registerSocialConsumers }     from "./modules/social/consumer.js";
import { registerVisitingCardConsumers } from "./modules/visiting-cards/consumer.js";
import { runSchedulerOnce } from "./modules/scheduler/tick.js";

const log = pino({ name: "hrms-worker" });

registerEmployeeConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerPromotionEOfficeConsumers(queue);
registerDisciplinaryConsumers(queue);
registerDisciplinaryEOfficeConsumers(queue);
registerLeaveConsumers(queue);
registerLeaveSpecialEOfficeConsumers(queue);
registerAttendanceConsumers(queue);
registerRecruitmentConsumers(queue);
registerRecruitmentEOfficeConsumers(queue);
registerTrainingConsumers(queue);
registerIntegrationConsumers(queue);
registerAppraisalConsumers(queue);
// Previous batch
registerAparConsumers(queue);
registerClaimsConsumers(queue);
registerDeputationConsumers(queue);
registerGeoAttendanceConsumers(queue);
registerGpfConsumers(queue);
registerHolidayConsumers(queue);
registerIdCardConsumers(queue);
registerMedicalConsumers(queue);
registerPayMatrixConsumers(queue);
registerPensionConsumers(queue);
registerReservationConsumers(queue);
registerSeniorityConsumers(queue);
registerServiceBookConsumers(queue);
registerWorkforcePlanningConsumers(queue);
// Current batch
registerAiFraudConsumers(queue);
registerAiPredictionsConsumers(queue);
registerBulkImportConsumers(queue);
registerDashboardConsumers(queue);
registerDeviceTrustConsumers(queue);
registerFaceVerificationConsumers(queue);
registerInternalConsumers(queue);
registerOrgchartConsumers(queue);
registerReportsConsumers(queue);
registerRtiConsumers(queue);
registerSchedulerConsumers(queue);
registerSelfServiceConsumers(queue);
registerSocialConsumers(queue);
registerVisitingCardConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);

// Scheduled-job layer: periodic tick producing tenant-aware due-lists
// (superannuation / probation). Interval is configurable; defaults to hourly.
// Idempotent per (tenant, list_kind, run_date) so frequent ticks are safe.
const SCHEDULER_INTERVAL_MS = Number(process.env.HRMS_SCHEDULER_INTERVAL_MS ?? 3_600_000);
let schedulerBusy = false;
async function schedulerTick(): Promise<void> {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const res = await runSchedulerOnce(db);
    log.info({ event: "scheduler.tick", ...res }, "scheduler tick produced due-lists");
  } catch (err) {
    log.error({ err }, "scheduler tick failed");
  } finally {
    schedulerBusy = false;
  }
}
// Run once shortly after boot, then on the interval.
const schedulerKickoff = setTimeout(() => void schedulerTick(), 5_000);
const schedulerTimer = setInterval(() => void schedulerTick(), SCHEDULER_INTERVAL_MS);

log.info({ schedulerIntervalMs: SCHEDULER_INTERVAL_MS },
  "hrms-service worker: consumers + outbox relay + scheduler running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearTimeout(schedulerKickoff);
  clearInterval(schedulerTimer);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
