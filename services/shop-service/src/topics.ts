export const COMMANDS = {
  // registrations
  createApplication: "shop.application.create",
  submitApplication: "shop.application.submit",
  withdrawApplication: "shop.application.withdraw",
  recordFeePayment: "shop.application.record_fee_payment",

  // approvals
  initiateScrutiny: "shop.scrutiny.initiate",
  completeScrutiny: "shop.scrutiny.complete",
  decideApplication: "shop.application.decide",

  // permits
  issuePermit: "shop.permit.issue",
  suspendPermit: "shop.permit.suspend",
  cancelPermit: "shop.permit.cancel",
  restorePermit: "shop.permit.restore",
  issueNotice: "shop.permit.issue_notice",

  // lifecycle
  requestRenewal: "shop.renewal.request",
  decideRenewal: "shop.renewal.decide",
  recordRenewalFeePayment: "shop.renewal.record_fee_payment",
} as const;

export const EVENTS = {
  // registrations
  applicationCreated: "shop.application.created",
  applicationSubmitted: "shop.application.submitted",
  applicationWithdrawn: "shop.application.withdrawn",
  feePaymentRecorded: "shop.application.fee_payment_recorded",

  // approvals
  scrutinyInitiated: "shop.scrutiny.initiated",
  scrutinyCompleted: "shop.scrutiny.completed",
  applicationDecided: "shop.application.decided",

  // permits
  permitIssued: "shop.permit.issued",
  permitSuspended: "shop.permit.suspended",
  permitCancelled: "shop.permit.cancelled",
  permitRestored: "shop.permit.restored",
  noticeIssued: "shop.permit.notice_issued",

  // lifecycle
  renewalRequested: "shop.renewal.requested",
  renewalDecided: "shop.renewal.decided",
  renewalFeePaymentRecorded: "shop.renewal.fee_payment_recorded",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "shop";
export const RESOURCE = "application";
