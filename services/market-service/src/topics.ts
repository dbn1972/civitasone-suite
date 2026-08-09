export const COMMANDS = {
  // properties
  createProperty: "market.property.create",
  updateProperty: "market.property.update",

  // allotments
  applyAllotment: "market.allotment.apply",
  selectAllottee: "market.allotment.select",
  signAgreement: "market.allotment.sign_agreement",

  // billing
  generateDemand: "market.demand.generate",
  recordPayment: "market.demand.record_payment",
  waiveDemand: "market.demand.waive",

  // lifecycle
  requestTransfer: "market.lifecycle.request_transfer",
  requestCancellation: "market.lifecycle.request_cancellation",
  initiateEviction: "market.lifecycle.initiate_eviction",
  approveRequest: "market.lifecycle.approve",
  rejectRequest: "market.lifecycle.reject",
  completeRequest: "market.lifecycle.complete",
} as const;

export const EVENTS = {
  // properties
  propertyCreated: "market.property.created",
  propertyUpdated: "market.property.updated",

  // allotments
  allotmentApplied: "market.allotment.applied",
  allotteeSelected: "market.allotment.selected",
  agreementSigned: "market.allotment.agreement_signed",

  // billing
  demandGenerated: "market.demand.generated",
  paymentRecorded: "market.demand.payment_recorded",
  demandWaived: "market.demand.waived",

  // lifecycle
  transferRequested: "market.lifecycle.transfer_requested",
  cancellationRequested: "market.lifecycle.cancellation_requested",
  evictionInitiated: "market.lifecycle.eviction_initiated",
  requestApproved: "market.lifecycle.approved",
  requestRejected: "market.lifecycle.rejected",
  requestCompleted: "market.lifecycle.completed",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "market";
