/** Topic + event names owned by finance-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // budget
  budgetCreate:         "finance.budget.create",
  budgetReappropriate:  "finance.budget.re_appropriate",
  sanctionCreate:       "finance.sanction.create",
  // gl
  journalPost:          "finance.gl.post",
  // treasury
  challanCreate:        "finance.challan.create",
  depositCreate:        "finance.deposit.create",
  // payments
  billCreate:           "finance.bill.create",
  billApprove:          "finance.bill.approve",
  paymentInitiate:      "finance.payment.initiate",
  gemInvoiceMatch:      "finance.gem.einvoice.match",
} as const;

export const EVENTS = {
  sanctionApproved: "finance.sanction.approved",
  billPassed:       "finance.bill.passed",
  billMismatch:     "finance.bill.mismatch",
  paymentMade:      "finance.payment.made",
  glPosted:         "finance.gl.posted",
} as const;

/** Topics consumed from other services (cross-service stitching) */
export const CONSUMED_EVENTS = {
  eftInitiate:              "finance.payment.eft.initiate",
  auditParaPendingRecovery: "audit.para.pending_recovery",
  payrollRunApproved:       "payroll.run.approved",
  grnAccepted:              "procurement.grn.accepted",
} as const;

export const SERVICE  = "finance";
