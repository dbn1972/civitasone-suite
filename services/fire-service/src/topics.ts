export const COMMANDS = {
  // applications
  createApplication: "fire.application.create",
  submitApplication: "fire.application.submit",
  withdrawApplication: "fire.application.withdraw",

  // inspections
  scheduleInspection: "fire.inspection.schedule",
  completeInspection: "fire.inspection.complete",
  recordFindings: "fire.inspection.record_findings",

  // nocs
  issueNoc: "fire.noc.issue",
  suspendNoc: "fire.noc.suspend",
  revokeNoc: "fire.noc.revoke",

  // lifecycle
  requestRenewal: "fire.renewal.request",
  decideRenewal: "fire.renewal.decide",
} as const;

export const EVENTS = {
  // applications
  applicationCreated: "fire.application.created",
  applicationSubmitted: "fire.application.submitted",
  applicationWithdrawn: "fire.application.withdrawn",

  // inspections
  inspectionScheduled: "fire.inspection.scheduled",
  inspectionCompleted: "fire.inspection.completed",
  findingsRecorded: "fire.inspection.findings_recorded",

  // nocs
  nocIssued: "fire.noc.issued",
  nocSuspended: "fire.noc.suspended",
  nocRevoked: "fire.noc.revoked",

  // lifecycle
  renewalRequested: "fire.renewal.requested",
  renewalDecided: "fire.renewal.decided",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "fire";
