export const COMMANDS = {
  // complaints
  reportComplaint: "animal.complaint.report",
  assignComplaint: "animal.complaint.assign",
  dispatchTeam: "animal.complaint.dispatch",
  markActionTaken: "animal.complaint.mark_action_taken",
  closeComplaint: "animal.complaint.close",

  // operations
  recordOperation: "animal.operation.record",

  // registration
  registerAnimal: "animal.registration.create",
  renewRegistration: "animal.registration.renew",
  transferRegistration: "animal.registration.transfer",
} as const;

export const EVENTS = {
  // complaints
  complaintReported: "animal.complaint.reported",
  complaintAssigned: "animal.complaint.assigned",
  teamDispatched: "animal.complaint.dispatched",
  actionTaken: "animal.complaint.action_taken",
  complaintClosed: "animal.complaint.closed",

  // operations
  operationRecorded: "animal.operation.recorded",

  // registration
  animalRegistered: "animal.registration.created",
  registrationRenewed: "animal.registration.renewed",
  registrationTransferred: "animal.registration.transferred",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "animal";
