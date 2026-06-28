export const COMMANDS = {
  employeeCreate:       "hrms.employee.create",
  employeeConfirm:      "hrms.employee.confirm",
  employeeTransfer:     "hrms.employee.transfer",
  employeeTransferSubmitApproval: "hrms.employee.transfer.submit_approval",
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
} as const;

export const SERVICE = "hrms";
