export const COMMANDS = {
  // registrations
  createRegistration: "vendor.registration.create",
  submitRegistration: "vendor.registration.submit",
  withdrawRegistration: "vendor.registration.withdraw",

  // committee
  assignCommitteeReview: "vendor.committee.assign",
  completeCommitteeReview: "vendor.committee.complete",
  allocateZone: "vendor.zone.allocate",
  approveRegistration: "vendor.registration.approve",
  rejectRegistration: "vendor.registration.reject",

  // licences
  issueLicence: "vendor.licence.issue",
  suspendLicence: "vendor.licence.suspend",
  cancelLicence: "vendor.licence.cancel",
  recordLicenceFee: "vendor.licence.record_fee",

  // lifecycle
  requestRenewal: "vendor.renewal.request",
  requestZoneTransfer: "vendor.zone_transfer.request",
  requestCancellation: "vendor.cancellation.request",
  requestSurrender: "vendor.surrender.request",
  decideLifecycleRequest: "vendor.lifecycle.decide",
} as const;

export const EVENTS = {
  // registrations
  registrationCreated: "vendor.registration.created",
  registrationSubmitted: "vendor.registration.submitted",
  registrationWithdrawn: "vendor.registration.withdrawn",

  // committee
  committeeReviewAssigned: "vendor.committee.assigned",
  committeeReviewCompleted: "vendor.committee.completed",
  zoneAllocated: "vendor.zone.allocated",
  registrationApproved: "vendor.registration.approved",
  registrationRejected: "vendor.registration.rejected",

  // licences
  licenceIssued: "vendor.licence.issued",
  licenceSuspended: "vendor.licence.suspended",
  licenceCancelled: "vendor.licence.cancelled",
  licenceFeeRecorded: "vendor.licence.fee_recorded",

  // lifecycle
  renewalRequested: "vendor.renewal.requested",
  zoneTransferRequested: "vendor.zone_transfer.requested",
  cancellationRequested: "vendor.cancellation.requested",
  surrenderRequested: "vendor.surrender.requested",
  lifecycleRequestDecided: "vendor.lifecycle.decided",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "vendor";
export const RESOURCE = "registration";
