export const COMMANDS = {
  // requests
  createRequest: "refund.request.create",
  submitRequest: "refund.request.submit",
  withdrawRequest: "refund.request.withdraw",

  // processing
  reviewRequest: "refund.request.review",
  approveRequest: "refund.approval.approve",
  rejectRequest: "refund.approval.reject",
  returnRequest: "refund.approval.return",

  // reconciliation
  initiateDisbursement: "refund.disbursement.initiate",
  completeDisbursement: "refund.disbursement.complete",
  failDisbursement: "refund.disbursement.fail",
  reconcile: "refund.reconciliation.reconcile",
} as const;

export const EVENTS = {
  // requests
  requestCreated: "refund.request.created",
  requestSubmitted: "refund.request.submitted",
  requestWithdrawn: "refund.request.withdrawn",

  // processing
  requestReviewed: "refund.request.reviewed",
  requestApproved: "refund.approval.approved",
  requestRejected: "refund.approval.rejected",
  requestReturned: "refund.approval.returned",

  // reconciliation
  disbursementInitiated: "refund.disbursement.initiated",
  disbursementCompleted: "refund.disbursement.completed",
  disbursementFailed: "refund.disbursement.failed",
  reconciled: "refund.reconciliation.reconciled",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "refund";
export const RESOURCE = "request";
