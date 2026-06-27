export const COMMANDS = {
  structureCreate:        "payroll.structure.create",
  runCreate:              "payroll.run.create",
  runApprove:             "payroll.run.approve",
  runDisburse:            "payroll.run.disburse",
  runRevert:              "payroll.run.revert",
  loanCreate:             "payroll.loan.create",
  loanDisburse:           "payroll.loan.disburse",
  taxDeclarationCreate:   "payroll.tax_declaration.create",
  taxDeclarationUpdate:   "payroll.tax_declaration.update",
  taxDeclarationSubmit:   "payroll.tax_declaration.submit",
} as const;

export const EVENTS = {
  runApproved:    "payroll.run.approved",
  runDisbursed:   "payroll.run.disbursed",
  loanDisbursed:  "payroll.loan.disbursed",
} as const;

export const CONSUMED_EVENTS = {
  leaveApproved:     "hrms.leave.approved",
  attendanceMarked:  "hrms.attendance.marked",
  employeeCreated:   "hrms.employee.created",
  employeeSeparated: "hrms.employee.separated",
  financePaymentMade: "finance.payment.made",
} as const;

export const SERVICE = "payroll";
