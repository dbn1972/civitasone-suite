/**
 * hrms-service consumer registration (ST-M01-04).
 *
 * Extracted from worker.ts so the SAME registration logic the worker runs can
 * be exercised in a test against a recording queue — the row requires the
 * core-only profile to assert that non-core consumers are NOT subscribed
 * "against the real worker registration".
 *
 * CORE (Workforce Core) consumers are always subscribed; non-core consumers
 * are subscribed only when the module profile enables them (HRMS_MODULES).
 * Unset => all (today's behaviour, no regression); "core" => Workforce Core.
 */
import type { Queue } from "@civitasone/queue";
import type { ModuleProfile } from "./shared/module-profile.js";

import { registerEmployeeConsumers }   from "./modules/employee/consumer.js";
import { registerLifecycleConsumers }  from "./modules/lifecycle/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/lifecycle/eoffice-consumer.js";
import { registerPromotionEOfficeConsumers } from "./modules/lifecycle/promotion-eoffice-consumer.js";
import { registerDisciplinaryConsumers } from "./modules/disciplinary/consumer.js";
import { registerDisciplinaryEOfficeConsumers } from "./modules/disciplinary/eoffice-consumer.js";
import { registerLeaveSpecialEOfficeConsumers } from "./modules/leave/eoffice-consumer.js";
import { registerRecruitmentEOfficeConsumers } from "./modules/recruitment/eoffice-consumer.js";
import { registerLeaveConsumers }      from "./modules/leave/consumer.js";
import { registerPolicySettingsConsumers } from "./modules/policy-settings/consumer.js";
import { registerAttendanceConsumers } from "./modules/attendance/consumer.js";
import { registerRecruitmentConsumers } from "./modules/recruitment/consumer.js";
import { registerRecruitmentFinishConsumers } from "./modules/recruitment/finish-consumer.js";
import { registerLifecycleMutationConsumers } from "./modules/lifecycle/consumer.js";
import { registerLoanConsumers } from "./modules/employee/loans-consumer.js";
import { registerF3LeftoverAll } from "./modules/f3-leftover-register.js";
import { registerTrainingConsumers }   from "./modules/training/consumer.js";
import { registerIntegrationConsumers } from "./modules/integration/consumer.js";
import { registerAppraisalConsumers }  from "./modules/appraisals/consumer.js";
import { registerAparConsumers }       from "./modules/apar/consumer.js";
import { registerClaimsConsumers }     from "./modules/claims/consumer.js";
import { registerDeputationConsumers } from "./modules/deputation/consumer.js";
import { registerPayProfileConsumers } from "./modules/pay-profile/consumer.js";
import { registerGrievanceConsumers } from "./modules/grievance/consumer.js";
import { registerOnboardingTemplateConsumers } from "./modules/lifecycle/onboarding-template.js";
import { registerGeoAttendanceConsumers } from "./modules/geo-attendance/consumer.js";
import { registerGpfConsumers }        from "./modules/gpf/consumer.js";
import { registerHolidayConsumers }    from "./modules/holidays/consumer.js";
import { registerIdCardConsumers }     from "./modules/id-cards/consumer.js";
import { registerMedicalConsumers }    from "./modules/medical/consumer.js";
import { registerScanLinkConsumers } from "./modules/employee/scan-link-consumer.js";
import { registerOutsourcedConsumers } from "./modules/outsourced/consumer.js";
import { registerPayMatrixConsumers }  from "./modules/pay-matrix/consumer.js";
import { registerPensionConsumers }    from "./modules/pension/consumer.js";
import { registerReservationConsumers } from "./modules/reservation/consumer.js";
import { registerSeniorityConsumers }  from "./modules/seniority/consumer.js";
import { registerServiceBookConsumers } from "./modules/service-book/consumer.js";
import { registerWorkforcePlanningConsumers } from "./modules/workforce-planning/consumer.js";
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
import { registerBoardIntakeConsumers } from "./modules/board-intake/consumer.js";
import { registerCompetencyConsumers } from "./modules/competency/consumer.js";
import { registerContractConsumers } from "./modules/contracts/consumer.js";
import { registerContractExpiryConsumers } from "./modules/contracts/expiry-consumer.js";
import { registerManpowerConsumers } from "./modules/manpower-planning/consumer.js";

/**
 * Subscribe every hrms-service consumer the given module profile enables.
 * Core consumers always subscribe; non-core ones are gated by HRMS_MODULES.
 */
export function registerConsumers(queue: Queue, profile: ModuleProfile): void {
  const nonCore = (m: Parameters<ModuleProfile["isNonCoreEnabled"]>[0]): boolean =>
    profile.isNonCoreEnabled(m);

  // ── CORE consumers (always on): employee, lifecycle (incl. eOffice
  // loop-back for transfer/promotion), posting-related service-book /
  // reservation / manpower, bulk import, dashboard / reports / orgchart /
  // holidays, scheduler, seniority, and the cross-service internal surface.
  registerEmployeeConsumers(queue);
  registerLifecycleMutationConsumers(queue);
  registerLifecycleConsumers(queue);
  registerEOfficeDecisionConsumers(queue);
  registerPromotionEOfficeConsumers(queue);
  registerOnboardingTemplateConsumers(queue);
  registerHolidayConsumers(queue);
  registerScanLinkConsumers(queue); // hr_employee scan-link target (document bulk-scan)
  registerReservationConsumers(queue);
  registerSeniorityConsumers(queue);
  registerServiceBookConsumers(queue);
  registerBulkImportConsumers(queue);
  registerDashboardConsumers(queue);
  registerInternalConsumers(queue);
  registerOrgchartConsumers(queue);
  registerReportsConsumers(queue);
  registerSchedulerConsumers(queue);
  registerManpowerConsumers(queue); // SVC-003: recruitment hire -> manpower plan fill-loop

  // F3 leftover register: core F3 always, non-core F3 gated by the same profile.
  registerF3LeftoverAll(queue, profile);

  // ── NON-CORE consumers (gated by HRMS_MODULES) ───────────────────────────
  if (nonCore("leave")) {
    registerLeaveConsumers(queue);
    registerPolicySettingsConsumers(queue);
    registerLeaveSpecialEOfficeConsumers(queue);
  }
  if (nonCore("attendance")) {
    registerAttendanceConsumers(queue);
    registerGeoAttendanceConsumers(queue);
    registerFaceVerificationConsumers(queue);
  }
  if (nonCore("recruitment")) {
    registerRecruitmentConsumers(queue);
    registerRecruitmentFinishConsumers(queue);
    registerRecruitmentEOfficeConsumers(queue);
  }
  if (nonCore("appraisal")) {
    registerAppraisalConsumers(queue);
    registerAparConsumers(queue);
  }
  if (nonCore("payroll_facing")) {
    registerLoanConsumers(queue);
    registerClaimsConsumers(queue);
    registerPayProfileConsumers(queue);
    registerGpfConsumers(queue);
    registerMedicalConsumers(queue);
    registerPayMatrixConsumers(queue);
    registerPensionConsumers(queue);
  }
  if (nonCore("training")) {
    registerTrainingConsumers(queue);
  }
  if (nonCore("social")) {
    registerSocialConsumers(queue);
  }
  if (nonCore("disciplinary")) {
    registerDisciplinaryConsumers(queue);
    registerDisciplinaryEOfficeConsumers(queue);
    registerGrievanceConsumers(queue);
  }
  if (nonCore("deputation")) {
    registerDeputationConsumers(queue);
  }
  if (nonCore("contracts")) {
    registerContractConsumers(queue);
    registerContractExpiryConsumers(queue);
    registerOutsourcedConsumers(queue);
  }
  if (nonCore("id_cards")) {
    registerIdCardConsumers(queue);
    registerVisitingCardConsumers(queue);
  }
  if (nonCore("device_trust")) {
    registerDeviceTrustConsumers(queue);
  }
  if (nonCore("ai")) {
    registerAiFraudConsumers(queue);
    registerAiPredictionsConsumers(queue);
  }
  if (nonCore("rti")) {
    registerRtiConsumers(queue);
  }
  if (nonCore("workforce_planning")) {
    registerWorkforcePlanningConsumers(queue);
  }
  if (nonCore("board_intake")) {
    // Cross-service choreography: board decision -> HR intake (for-review).
    registerBoardIntakeConsumers(queue);
  }
  if (nonCore("competency")) {
    // SVC-124: assessment.certificate.issued -> employee held competency.
    registerCompetencyConsumers(queue);
  }
  if (nonCore("self_service")) {
    registerSelfServiceConsumers(queue);
  }
  // integration sync consumer (external HRMS adapter) available whenever any
  // non-core module is on.
  if (!profile.coreOnly) {
    registerIntegrationConsumers(queue);
  }
}
