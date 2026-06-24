/** Topic + event names owned by grant-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // scheme
  schemeCreate:           "grant.scheme.create",
  eligibilityCreate:      "grant.eligibility.create",
  // application
  applicationSubmit:      "grant.application.submit",
  applicationScore:       "grant.application.score",
  applicationApprove:     "grant.application.approve",
  applicationReject:      "grant.application.reject",
  // disbursement
  installmentCreate:      "grant.installment.create",
  disbursementInitiate:   "grant.disbursement.initiate",
  pfmsReconcile:          "grant.pfms.reconcile",
  // utilisation
  ucSubmit:               "grant.uc.submit",
  complianceReport:       "grant.compliance.report",
  // beneficiary
  beneficiaryCreate:      "grant.beneficiary.create",
  beneficiaryLinkBank:    "grant.beneficiary.link_bank",
  beneficiarySeedAadhaar: "grant.beneficiary.seed_aadhaar",
} as const;

export const EVENTS = {
  schemeCreated:              "grant.scheme.created",
  applicationApproved:        "grant.application.approved",
  applicationRejected:        "grant.application.rejected",
  disbursementCompleted:      "grant.disbursement.completed",
  disbursementFailed:         "grant.disbursement.failed",
  ucSubmitted:                "grant.uc.submitted",
  beneficiaryCreated:         "grant.beneficiary.created",
  disbursementExceedsApproved: "grant.disbursement.exceeds_approved",
  ucExpenditureExceeds:       "grant.uc.expenditure_exceeds",
  ucGateBlocked:              "grant.disbursement.uc_gate_blocked",
  schemeBudgetExceeded:       "grant.scheme.budget_exceeded",
  ucValidated:                "grant.uc.validated",
  ucRejected:                 "grant.uc.rejected",
} as const;

/** Topics consumed from other services */
export const CONSUMED_EVENTS = {
  financePaid: "finance.payment.made",
} as const;

export const SERVICE = "grant";
