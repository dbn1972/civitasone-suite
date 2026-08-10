export const COMMANDS = {
  // applications
  createApplication: "advertisement.application.create",
  submitApplication: "advertisement.application.submit",

  // approvals
  initiateScrutiny: "advertisement.scrutiny.initiate",
  completeScrutiny: "advertisement.scrutiny.complete",
  decideApplication: "advertisement.application.decide",

  // permits
  issuePermit: "advertisement.permit.issue",
  renewPermit: "advertisement.permit.renew",
  suspendPermit: "advertisement.permit.suspend",
  cancelPermit: "advertisement.permit.cancel",

  // enforcement
  reportViolation: "advertisement.violation.report",
  issueNotice: "advertisement.violation.issue_notice",
  imposePenalty: "advertisement.violation.impose_penalty",
  orderRemoval: "advertisement.violation.order_removal",
  recordRemoval: "advertisement.violation.record_removal",
} as const;

export const EVENTS = {
  // applications
  applicationCreated: "advertisement.application.created",
  applicationSubmitted: "advertisement.application.submitted",

  // approvals
  scrutinyInitiated: "advertisement.scrutiny.initiated",
  scrutinyCompleted: "advertisement.scrutiny.completed",
  applicationDecided: "advertisement.application.decided",

  // permits
  permitIssued: "advertisement.permit.issued",
  permitRenewed: "advertisement.permit.renewed",
  permitSuspended: "advertisement.permit.suspended",
  permitCancelled: "advertisement.permit.cancelled",

  // enforcement
  violationReported: "advertisement.violation.reported",
  noticeIssued: "advertisement.violation.notice_issued",
  penaltyImposed: "advertisement.violation.penalty_imposed",
  removalOrdered: "advertisement.violation.removal_ordered",
  removalRecorded: "advertisement.violation.removal_recorded",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "advertisement";
