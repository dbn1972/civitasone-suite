export const COMMANDS = {
  // applications
  createApplication: "roadcut.application.create",
  submitApplication: "roadcut.application.submit",
  withdrawApplication: "roadcut.application.withdraw",

  // permits
  issuePermit: "roadcut.permit.issue",
  extendPermit: "roadcut.permit.extend",
  completePermit: "roadcut.permit.complete",
  cancelPermit: "roadcut.permit.cancel",

  // inspections
  scheduleInspection: "roadcut.inspection.schedule",
  completeInspection: "roadcut.inspection.complete",

  // restoration
  startRestoration: "roadcut.restoration.start",
  completeRestoration: "roadcut.restoration.complete",
  decideDepositRefund: "roadcut.deposit.decide",
} as const;

export const EVENTS = {
  // applications
  applicationCreated: "roadcut.application.created",
  applicationSubmitted: "roadcut.application.submitted",
  applicationWithdrawn: "roadcut.application.withdrawn",

  // permits
  permitIssued: "roadcut.permit.issued",
  permitExtended: "roadcut.permit.extended",
  permitCompleted: "roadcut.permit.completed",
  permitCancelled: "roadcut.permit.cancelled",

  // inspections
  inspectionScheduled: "roadcut.inspection.scheduled",
  inspectionCompleted: "roadcut.inspection.completed",

  // restoration
  restorationStarted: "roadcut.restoration.started",
  restorationCompleted: "roadcut.restoration.completed",
  depositRefundDecided: "roadcut.deposit.decided",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "roadcut";
export const RESOURCE = "application";
