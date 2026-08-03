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
  exemptionCeilingUpsert: "payroll.exemption_ceiling.upsert",
  perquisiteComponentUpsert: "payroll.perquisite_component.upsert",
  // CQRS lift (quality-payroll-95): these routes used to write synchronously
  // in the request path (raw INSERT / Drizzle insert) — moved to async
  // command + idempotent consumer, mirroring works-service #354.
  ddoUpsert:              "payroll.ddo.upsert",
  pensionerCreate:        "payroll.pensioner.create",
  arrearCreate:           "payroll.arrear.create",
  bonusCompute:           "payroll.bonus.compute",
  reimbursementCreate:    "payroll.reimbursement.create",
  // CQRS lift T1-03 (payroll/gap-routes.ts) — 8 mutating routes moved to
  // publish + idempotent consumer; mirrors ddo/pensioner/arrear/bonus/
  // reimbursement above.
  correctionCreate:       "payroll.correction.create",
  payGroupCreate:         "payroll.paygroup.create",
  flexPlanCreate:         "payroll.flex_plan.create",
  flexElectionUpsert:     "payroll.flex_election.upsert",
  costingRuleUpsert:      "payroll.costing_rule.upsert",
  offCycleCreate:         "payroll.off_cycle.create",
  offCycleProcess:        "payroll.off_cycle.process",
  stateRulesUpsert:       "payroll.state_rules.upsert",
  // F3 leftover CQRS — challan / dsc / sponsor sync route writes
  tdsChallanIngest:       "payroll.tds_challan.ingest",
  dscConfigUpsert:        "payroll.dsc_config.upsert",
  dscConfigRemove:        "payroll.dsc_config.remove",
  sponsorConfigUpsert:    "payroll.sponsor_config.upsert",
  // Read-side audit events previously written via route db.transaction+outbox
  auditRecord:            "payroll.audit.record",
} as const;

export const EVENTS = {
  runApproved:            "payroll.run.approved",
  runDisbursed:           "payroll.run.disbursed",
  loanDisbursed:          "payroll.loan.disbursed",
  nachReturnProcessed:    "payroll.nach_return.processed",
  fnfComputed:            "payroll.fnf.computed",
  fnfDraftCreated:        "payroll.fnf.draft_created",
  form16BulkCompleted:    "payroll.form16.bulk_completed",
  exemptionCeilingUpserted: "payroll.exemption_ceiling.upserted",
  perquisiteComponentUpserted: "payroll.perquisite_component.upserted",
  dscExpiryWarning:       "payroll.dsc.expiry_warning",
  ddoUpserted:            "payroll.ddo.upserted",
  pensionerCreated:       "payroll.pensioner.created",
  arrearCreated:          "payroll.arrear.created",
  bonusComputed:          "payroll.bonus.computed",
  reimbursementCreated:   "payroll.reimbursement.created",
  correctionCreated:      "payroll.correction.created",
  payGroupCreated:        "payroll.paygroup.created",
  flexPlanCreated:        "payroll.flex_plan.created",
  flexElectionUpserted:   "payroll.flex_election.upserted",
  costingRuleUpserted:    "payroll.costing_rule.upserted",
  offCycleCreated:        "payroll.off_cycle.created",
  offCycleProcessed:      "payroll.off_cycle.processed",
  stateRulesUpserted:     "payroll.state_rules.upserted",
  tdsChallanIngested:     "payroll.tds_challan.ingested",
  dscConfigUpserted:      "payroll.dsc_config.upserted",
  dscConfigRemoved:       "payroll.dsc_config.removed",
  sponsorConfigUpserted:  "payroll.sponsor_config.upserted",
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
