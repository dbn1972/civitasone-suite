export const COMMANDS = {
  // applications
  createApplication: "building.application.create",
  submitApplication: "building.application.submit",
  withdrawApplication: "building.application.withdraw",
  recordFeePayment: "building.application.record_fee_payment",

  // scrutiny
  initiateScrutiny: "building.scrutiny.initiate",
  completeScrutiny: "building.scrutiny.complete",
  decideApplication: "building.application.decide",

  // permits
  issuePermit: "building.permit.issue",
  suspendPermit: "building.permit.suspend",
  cancelPermit: "building.permit.cancel",
  restorePermit: "building.permit.restore",

  // lifecycle
  issueCertificate: "building.certificate.issue",
  requestRenewal: "building.renewal.request",
  decideRenewal: "building.renewal.decide",
} as const;

export const EVENTS = {
  // applications
  applicationCreated: "building.application.created",
  applicationSubmitted: "building.application.submitted",
  applicationWithdrawn: "building.application.withdrawn",
  feePaymentRecorded: "building.application.fee_payment_recorded",

  // scrutiny
  scrutinyInitiated: "building.scrutiny.initiated",
  scrutinyCompleted: "building.scrutiny.completed",
  applicationDecided: "building.application.decided",

  // permits
  permitIssued: "building.permit.issued",
  permitSuspended: "building.permit.suspended",
  permitCancelled: "building.permit.cancelled",
  permitRestored: "building.permit.restored",

  // lifecycle
  certificateIssued: "building.certificate.issued",
  renewalRequested: "building.renewal.requested",
  renewalDecided: "building.renewal.decided",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "building";
