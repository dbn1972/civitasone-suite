/** Topic + event names owned by grant-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // scheme
  schemeCreate:           "grant.scheme.create",
  schemeUpdate:           "grant.scheme.update",
  schemeClose:            "grant.scheme.close",
  eligibilityCreate:      "grant.eligibility.create",
  // application
  applicationSubmit:      "grant.application.submit",
  applicationScore:       "grant.application.score",
  applicationApprove:     "grant.application.approve",
  applicationReject:      "grant.application.reject",
  applicationWithdraw:    "grant.application.withdraw",
  applicationAssignReviewer: "grant.application.assign_reviewer",
  // disbursement
  installmentCreate:      "grant.installment.create",
  disbursementInitiate:   "grant.disbursement.initiate",
  disbursementSubmitApproval: "grant.disbursement.submit_approval",
  pfmsReconcile:          "grant.pfms.reconcile",
  // utilisation
  ucSubmit:               "grant.uc.submit",
  complianceReport:       "grant.compliance.report",
  /** Persist UC validation decision + flip statement.validation_status. */
  ucValidate:             "grant.uc.validate",
  // beneficiary
  beneficiaryCreate:      "grant.beneficiary.create",
  beneficiaryLinkBank:    "grant.beneficiary.link_bank",
  beneficiarySeedAadhaar: "grant.beneficiary.seed_aadhaar",
} as const;

export const EVENTS = {
  schemeCreated:              "grant.scheme.created",
  schemeUpdated:              "grant.scheme.updated",
  schemeClosed:               "grant.scheme.closed",
  applicationApproved:        "grant.application.approved",
  applicationRejected:        "grant.application.rejected",
  applicationWithdrawn:       "grant.application.withdrawn",
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
  projectMilestoneCompleted: "project.milestone.completed",
  disbursementFileDecided: "grant.disbursement.file_decided",
  // eOffice decision callback for a grant scheme eFile
  // (source_ref_type "grant_scheme"). See modules/scheme/eoffice-consumer.ts.
  schemeFileDecided: "grant.scheme.file_decided",
} as const;

export const SERVICE = "grant";
