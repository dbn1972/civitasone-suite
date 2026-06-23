export const COMMANDS = {
  employeeCreate:       "hrms.employee.create",
  employeeConfirm:      "hrms.employee.confirm",
  employeeTransfer:     "hrms.employee.transfer",
  employeeSeparate:     "hrms.employee.separate",
  leaveTypeCreate:      "hrms.leave_type.create",
  leaveAllocate:        "hrms.leave.allocate",
  leaveApply:           "hrms.leave.apply",
  leaveApprove:         "hrms.leave.approve",
  attendanceMark:       "hrms.attendance.mark",
  jobCreate:            "hrms.job.create",
  applicationCreate:    "hrms.application.create",
  applicationOffer:     "hrms.application.offer",
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
} as const;

export const SERVICE = "hrms";
