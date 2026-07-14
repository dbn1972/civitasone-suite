export const COMMANDS = {
  employeeCreate:       "hrms.employee.create",
  employeeConfirm:      "hrms.employee.confirm",
  employeeTransfer:     "hrms.employee.transfer",
  employeeTransferSubmitApproval: "hrms.employee.transfer.submit_approval",
  employeePromotionSubmitApproval: "hrms.employee.promotion.submit_approval",
  disciplinarySubmitApproval: "hrms.disciplinary.submit_approval",
  employeeSeparate:     "hrms.employee.separate",
  employeeUpdate:       "hrms.employee.update",
  leaveTypeCreate:      "hrms.leave_type.create",
  leaveAllocate:        "hrms.leave.allocate",
  leaveApply:           "hrms.leave.apply",
  leaveApprove:         "hrms.leave.approve",
  leaveReject:          "hrms.leave.reject",
  attendanceMark:       "hrms.attendance.mark",
  regularisationCreate: "hrms.attendance.regularisation.create",
  appraisalCreate:      "hrms.appraisal.create",
  appraisalAdvanceStage: "hrms.appraisal.advance_stage",
  jobCreate:            "hrms.job.create",
  applicationCreate:    "hrms.application.create",
  applicationOffer:     "hrms.application.offer",
  applicationHire:      "hrms.application.hire",
  trainingCreate:       "hrms.training.create",
  nominationCreate:     "hrms.nomination.create",

  // lifecycle
  lifecycleConfirm:     "hrms.lifecycle.confirm",
  lifecycleSeparate:    "hrms.lifecycle.separate",
  lifecycleReinstate:   "hrms.lifecycle.reinstate",

  // deputation
  deputationCreate:     "hrms.deputation.create",
  deputationExtend:     "hrms.deputation.extend",
  deputationRevert:     "hrms.deputation.revert",

  // medical
  medicalClaimCreate:   "hrms.medical_claim.create",
  medicalClaimApprove:  "hrms.medical_claim.approve",

  // claims (LTC / CEA)
  claimCreate:          "hrms.claim.create",
  claimApprove:         "hrms.claim.approve",
  claimReject:          "hrms.claim.reject",

  // pension
  pensionInitiate:      "hrms.pension.initiate",
  pensionApprove:       "hrms.pension.approve",
  pensionCalculate:     "hrms.pension.calculate",

  // gpf
  gpfAdvance:           "hrms.gpf.advance",
  gpfWithdrawal:        "hrms.gpf.withdrawal",
  gpfFinalSettlement:   "hrms.gpf.final_settlement",

  // seniority
  seniorityGenerate:    "hrms.seniority.generate",
  seniorityApprove:     "hrms.seniority.approve",

  // service-book
  serviceBookAddEntry:  "hrms.service_book.add_entry",
  serviceBookVerify:    "hrms.service_book.verify",

  // apar
  aparCreate:           "hrms.apar.create",
  aparSubmit:           "hrms.apar.submit",
  aparReview:           "hrms.apar.review",
  aparAccept:           "hrms.apar.accept",

  // geo-attendance
  geoCheckIn:           "hrms.geo_attendance.check_in",
  geoCheckOut:          "hrms.geo_attendance.check_out",

  // holidays
  holidayCreate:        "hrms.holiday.create",
  holidayDelete:        "hrms.holiday.delete",

  // id-cards
  idCardIssue:          "hrms.id_card.issue",
  idCardSuspend:        "hrms.id_card.suspend",
  idCardRevoke:         "hrms.id_card.revoke",
  idCardReactivate:     "hrms.id_card.reactivate",

  // pay-matrix
  payMatrixIncrement:   "hrms.pay_matrix.annual_increment",

  // reservation
  rosterCreate:         "hrms.roster.create",
  rosterGeneratePoints: "hrms.roster.generate_points",
  sanctionedPostCreate: "hrms.sanctioned_post.create",

  // workforce-planning
  workforcePlanRefresh: "hrms.workforce_plan.refresh",
} as const;

export const EVENTS = {
  employeeCreated:   "hrms.employee.created",
  employeeSeparated: "hrms.employee.separated",
  leaveApplied:      "hrms.leave.applied",
  leaveApproved:     "hrms.leave.approved",
  attendanceMarked:  "hrms.attendance.marked",
} as const;

export const CONSUMED_EVENTS = {
  tenantCreated: "tenant.tenant.created",
  // eOffice (estab-service) decision callback for an HR transfer eFile
  // (source_ref_type "hr_transfer"). Closes the approval loop — see
  // modules/lifecycle/eoffice-consumer.ts.
  transferFileDecided: "hrms.transfer.file_decided",
  // eOffice decision callback for an HR promotion eFile
  // (source_ref_type "hr_promotion"). See modules/lifecycle/promotion-eoffice-consumer.ts.
  promotionFileDecided: "hrms.promotion.file_decided",
  // eOffice decision callback for an HR disciplinary eFile
  // (source_ref_type "hr_disciplinary"). See modules/disciplinary/eoffice-consumer.ts.
  disciplinaryFileDecided: "hrms.disciplinary.file_decided",
  // eOffice decision callback for a special leave eFile
  // (source_ref_type "hr_leave_special"). See modules/leave/eoffice-consumer.ts.
  leaveSpecialFileDecided: "hrms.leave_special.file_decided",
  // eOffice decision callback for an HR recruitment eFile
  // (source_ref_type "hr_recruitment"). See modules/recruitment/eoffice-consumer.ts.
  recruitmentFileDecided: "hrms.recruitment.file_decided",
  // meeting-service board/committee free-text HR decision (Req 22.3). Opens a
  // PENDING_REVIEW triage item — see modules/board-intake/consumer.ts. Payload:
  // { decisionId, meetingId, text, authority?, effectiveDate?, committeeId? }.
  boardDecisionHr: "meeting.decision.hr",
} as const;

export const SERVICE = "hrms";
