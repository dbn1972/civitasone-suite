/** Topic + event names owned by finance-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // budget
  budgetCreate:         "finance.budget.create",
  budgetReappropriate:  "finance.budget.re_appropriate",
  sanctionCreate:       "finance.sanction.create",
  sanctionReject:       "finance.sanction.reject",
  // gl
  journalPost:          "finance.gl.post",
  journalReverse:       "finance.gl.reverse",
  // treasury
  challanCreate:        "finance.challan.create",
  depositCreate:        "finance.deposit.create",
  depositRefund:        "finance.deposit.refund",
  depositForfeit:       "finance.deposit.forfeit",
  depositAdjust:        "finance.deposit.adjust",
  // payments
  billCreate:           "finance.bill.create",
  billApprove:          "finance.bill.approve",
  paymentInitiate:      "finance.payment.initiate",
  gemInvoiceMatch:      "finance.gem.einvoice.match",
  // advances & utilization certificates
  advanceCreate:        "finance.advance.create",
  advanceAdjust:        "finance.advance.adjust",
  ucCreate:             "finance.uc.create",
} as const;

export const EVENTS = {
  sanctionApproved: "finance.sanction.approved",
  billPassed:       "finance.bill.passed",
  billMismatch:     "finance.bill.mismatch",
  paymentMade:      "finance.payment.made",
  glPosted:         "finance.gl.posted",
  ucReconciled:     "finance.uc.reconciled",
} as const;

/** Topics consumed from other services (cross-service stitching) */
export const CONSUMED_EVENTS = {
  eftInitiate:              "finance.payment.eft.initiate",
  auditParaPendingRecovery: "audit.para.pending_recovery",
  payrollRunApproved:       "payroll.run.approved",
  grnAccepted:              "procurement.grn.accepted",
  grantUcSubmitted:         "grant.uc.submitted",
} as const;

export const SERVICE  = "finance";
