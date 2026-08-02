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
  nachReturnProcess:      "payroll.nach_return.process",
  fnfCompute:             "payroll.fnf.compute",
  form16BulkGenerate:     "payroll.form16.bulk_generate",
  // CQRS lift (quality-payroll-95): these routes used to write synchronously
  // in the request path (raw INSERT / Drizzle insert) — moved to async
  // command + idempotent consumer, mirroring works-service #354.
  ddoUpsert:              "payroll.ddo.upsert",
  pensionerCreate:        "payroll.pensioner.create",
  arrearCreate:           "payroll.arrear.create",
  bonusCompute:           "payroll.bonus.compute",
  reimbursementCreate:    "payroll.reimbursement.create",
} as const;

export const EVENTS = {
  runApproved:            "payroll.run.approved",
  runDisbursed:           "payroll.run.disbursed",
  loanDisbursed:          "payroll.loan.disbursed",
  nachReturnProcessed:    "payroll.nach_return.processed",
  fnfComputed:            "payroll.fnf.computed",
  fnfDraftCreated:        "payroll.fnf.draft_created",
  form16BulkCompleted:    "payroll.form16.bulk_completed",
  dscExpiryWarning:       "payroll.dsc.expiry_warning",
  ddoUpserted:            "payroll.ddo.upserted",
  pensionerCreated:       "payroll.pensioner.created",
  arrearCreated:          "payroll.arrear.created",
  bonusComputed:          "payroll.bonus.computed",
  reimbursementCreated:   "payroll.reimbursement.created",
} as const;

export const CONSUMED_EVENTS = {
  leaveApproved:     "hrms.leave.approved",
  attendanceMarked:  "hrms.attendance.marked",
  employeeCreated:   "hrms.employee.created",
  employeeSeparated: "hrms.employee.separated",
  financePaymentMade: "finance.payment.made",
  ltcClaimApproved:  "hrms.claim.approved",
} as const;

export const SERVICE = "payroll";
