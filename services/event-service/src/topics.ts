export const COMMANDS = {
  // applications
  createApplication: "event.application.create",
  submitApplication: "event.application.submit",
  withdrawApplication: "event.application.withdraw",

  // nocs
  requestNoc: "event.noc.request",
  respondNoc: "event.noc.respond",

  // permits
  issuePermit: "event.permit.issue",
  revokePermit: "event.permit.revoke",

  // post_event
  conductInspection: "event.post_inspection.conduct",
  decideDeposit: "event.deposit.decide",
} as const;

export const EVENTS = {
  // applications
  applicationCreated: "event.application.created",
  applicationSubmitted: "event.application.submitted",
  applicationWithdrawn: "event.application.withdrawn",

  // nocs
  nocRequested: "event.noc.requested",
  nocResponded: "event.noc.responded",

  // permits
  permitIssued: "event.permit.issued",
  permitRevoked: "event.permit.revoked",

  // post_event
  inspectionConducted: "event.post_inspection.conducted",
  depositDecided: "event.deposit.decided",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "event";
export const RESOURCE = "application";
