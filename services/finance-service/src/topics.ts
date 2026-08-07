/** Topic + event names owned by finance-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // budget
  budgetCreate:         "finance.budget.create",
  budgetReappropriate:  "finance.budget.re_appropriate",
  reappropriationSubmitApproval: "finance.reappropriation.submit_approval",
  sanctionCreate:       "finance.sanction.create",
  sanctionReject:       "finance.sanction.reject",
  sanctionApprove:      "finance.sanction.approve",
  sanctionSubmitApproval: "finance.sanction.submit_approval",
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
  paymentSubmitApproval: "finance.payment.submit_approval",
  gemInvoiceMatch:      "finance.gem.einvoice.match",
  // advances & utilization certificates
  advanceCreate:        "finance.advance.create",
  advanceAdjust:        "finance.advance.adjust",
  ucCreate:             "finance.uc.create",
  // bank-recon
  bankStatementImport:  "finance.bank_statement.import",
  bankStatementReconcile: "finance.bank_statement.reconcile",
  // org-structure
  legalEntityCreate:    "finance.org_structure.legal_entity_create",
  operatingUnitCreate:  "finance.org_structure.operating_unit_create",
  costCenterCreate:     "finance.org_structure.cost_center_create",
  profitCenterCreate:   "finance.org_structure.profit_center_create",
  // period-close
  periodClose:          "finance.period.close",
  periodReopen:         "finance.period.reopen",
  // pfms
  pfmsBatchSign:        "finance.pfms.batch_sign",
  pfmsBatchSubmit:      "finance.pfms.batch_submit",
  // recon (CAP-059)
  reconRun:             "finance.recon.run",
  reconExceptionAction: "finance.recon.exception_action",
  // masters (bank / FY / opening balances)
  bankAccountCreate: "finance.masters.bank_account.create",
  fiscalYearCreate: "finance.masters.fiscal_year.create",
  fiscalYearActivate: "finance.masters.fiscal_year.activate",
  openingBalancesEnter: "finance.masters.opening_balances.enter",
  // budget allocation / distribution / formulation (F3 CQRS)
  budgetAllocationUpsert: "finance.budget.allocation.upsert",
  budgetAllocationReappropriate: "finance.budget.allocation.reappropriate",
  allocationDistributionCreate: "finance.budget.distribution.create",
  allocationDistributionIssue: "finance.budget.distribution.issue",
  allocationDistributionAcknowledge: "finance.budget.distribution.acknowledge",
  budgetProposalCreate: "finance.budget.proposal.create",
  budgetProposalSubmit: "finance.budget.proposal.submit",
  budgetProposalReview: "finance.budget.proposal.review",
  budgetProposalRevise: "finance.budget.proposal.revise",
  budgetProposalApprove: "finance.budget.proposal.approve",
  // budget outcome / supplementary (F3 CQRS residuals)
  budgetOutcomeCreate: "finance.budget.outcome.create",
  budgetOutcomeAchievement: "finance.budget.outcome.achievement",
  budgetOutcomeEvaluate: "finance.budget.outcome.evaluate",
  supplementaryCreate: "finance.budget.supplementary.create",
  supplementaryApprove: "finance.budget.supplementary.approve",
  supplementaryReject: "finance.budget.supplementary.reject",
  // recurring / tds (wire routes to existing consumers)
  recurringEntryCreate: "finance.recurring.entry_create",
  recurringEntryUpdate: "finance.recurring.entry_update",
  tdsDeductionRecord: "finance.tds.deduction_record",
  tdsDepositMark: "finance.tds.deposit_mark",
} as const;

export const EVENTS = {
  sanctionApproved: "finance.sanction.approved",
  billPassed:       "finance.bill.passed",
  billMismatch:     "finance.bill.mismatch",
  paymentMade:      "finance.payment.made",
  glPosted:         "finance.gl.posted",
  glRejected:       "finance.gl.rejected",
  ucReconciled:     "finance.uc.reconciled",
  /** Transaction posted (journal entry committed) — consumed by ml-service for anomaly detection. */
  transactionPosted: "finance.transaction.posted",
  /** SVC-040: a budget outcome has been evaluated (maker-checker). */
  outcomeEvaluated:  "finance.budget.outcome_evaluated",
  /** SVC-031: a departmental budget proposal has been approved (maker-checker). */
  proposalApproved:  "finance.budget.proposal_approved",
  /** SVC-033: an allocation slice has been distributed to a subordinate office. */
  allocationDistributed: "finance.budget.allocation_distributed",
  /** SVC-035: a supplementary/additional grant has been approved (maker-checker). */
  supplementaryApproved: "finance.budget.supplementary_approved",
} as const;

/** Topics consumed from other services (cross-service stitching) */
export const CONSUMED_EVENTS = {
  eftInitiate:              "finance.payment.eft.initiate",
  auditParaPendingRecovery: "audit.para.pending_recovery",
  payrollRunApproved:       "payroll.run.approved",
  /** BL-03: payroll emits run.disbursed; the previous "payroll.run.finalized"
   * subscription was dead — no service ever emitted that topic, so the salary
   * settlement never posted to the GL. */
  payrollRunDisbursed:      "payroll.run.disbursed",
  grnAccepted:              "procurement.grn.accepted",
  grantUcSubmitted:         "grant.uc.submitted",
  sanctionFileDecided:      "finance.sanction.file_decided",
  paymentFileDecided:       "finance.payment.file_decided",
  reappropriationFileDecided: "finance.reappropriation.file_decided",
  /** ml-service emits anomaly detected when transaction Z-score > 3. */
  mlAnomalyDetected:        "ml.prediction.anomaly_detected",
  /** revenue-service: receipt captured (collections → GL posting). */
  revenueReceiptCaptured:   "revenue.receipt.captured",
  /** revenue-service: refund processed (GL reversal). */
  revenueRefundProcessed:   "revenue.refund.processed",
  /** billing-service: SaaS invoice issued (revenue recognition). */
  billingInvoiceIssued:     "billing.invoice.issued",
  /** billing-service: SaaS invoice paid (cash receipt → GL). */
  billingInvoicePaid:       "billing.invoice.paid",
  /** revenue-service: a payment receipt has been captured (DR Cash, CR Revenue). */
  revenueReceiptCaptured:   "revenue.receipt.captured",
  /** revenue-service: a refund has been processed against a prior receipt. */
  revenueRefundProcessed:   "revenue.refund.processed",
  /** billing-service: a SaaS invoice has been issued to a customer. */
  billingInvoiceIssued:     "billing.invoice.issued",
  /** billing-service: an issued invoice has been paid by the customer. */
  billingInvoicePaid:       "billing.invoice.paid",
  /**
   * Owner: meeting-service. Fires when a board/committee records a decision with a
   * financial implication (Req 22.2). payload: { decisionId, meetingId, text,
   * financialImplication?: string (paise bigint), currency?, authority?, effectiveDate? }.
   * Action: open a PENDING REVIEW sanction-intake item (no auto-sanction; GFR maker-checker).
   */
  meetingDecisionFinancial: "meeting.decision.financial",
} as const;

export const SERVICE  = "finance";
