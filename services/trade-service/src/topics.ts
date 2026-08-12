export const COMMANDS = {
  // applications
  createApplication: "trade.application.create",
  submitApplication: "trade.application.submit",
  withdrawApplication: "trade.application.withdraw",
  recordFeePayment: "trade.application.record_fee_payment",

  // approvals
  initiateScrutiny: "trade.scrutiny.initiate",
  completeScrutiny: "trade.scrutiny.complete",
  decideApplication: "trade.application.decide",

  // licences
  issueLicence: "trade.licence.issue",
  suspendLicence: "trade.licence.suspend",
  cancelLicence: "trade.licence.cancel",
  restoreLicence: "trade.licence.restore",
  issueNotice: "trade.licence.issue_notice",

  // lifecycle
  requestRenewal: "trade.renewal.request",
  decideRenewal: "trade.renewal.decide",
} as const;

export const EVENTS = {
  // applications
  applicationCreated: "trade.application.created",
  applicationSubmitted: "trade.application.submitted",
  applicationWithdrawn: "trade.application.withdrawn",
  feePaymentRecorded: "trade.application.fee_payment_recorded",

  // approvals
  scrutinyInitiated: "trade.scrutiny.initiated",
  scrutinyCompleted: "trade.scrutiny.completed",
  applicationDecided: "trade.application.decided",

  // licences
  licenceIssued: "trade.licence.issued",
  licenceSuspended: "trade.licence.suspended",
  licenceCancelled: "trade.licence.cancelled",
  licenceRestored: "trade.licence.restored",
  noticeIssued: "trade.licence.notice_issued",

  // lifecycle
  renewalRequested: "trade.renewal.requested",
  renewalDecided: "trade.renewal.decided",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "trade";
