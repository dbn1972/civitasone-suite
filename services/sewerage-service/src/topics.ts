export const COMMANDS = {
  connectionApply: "sewerage.connection.apply",
  connectionUpdateStatus: "sewerage.connection.update_status",
  connectionActivate: "sewerage.connection.activate",
  billGenerate: "sewerage.bill.generate",
  billPay: "sewerage.bill.pay",
  complaintCreate: "sewerage.complaint.create",
  complaintAssign: "sewerage.complaint.assign",
  complaintResolve: "sewerage.complaint.resolve",
  complaintClose: "sewerage.complaint.close",
  desludgingBook: "sewerage.desludging.book",
  desludgingSchedule: "sewerage.desludging.schedule",
  desludgingDispatch: "sewerage.desludging.dispatch",
  desludgingComplete: "sewerage.desludging.complete",
  desludgingCancel: "sewerage.desludging.cancel",
  fieldRecordCreate: "sewerage.field_record.create",
} as const;

export const EVENTS = {
  connectionApplied: "sewerage.connection.applied",
  connectionStatusUpdated: "sewerage.connection.status_updated",
  connectionActivated: "sewerage.connection.activated",
  billGenerated: "sewerage.bill.generated",
  billPaid: "sewerage.bill.paid",
  complaintCreated: "sewerage.complaint.created",
  complaintAssigned: "sewerage.complaint.assigned",
  complaintResolved: "sewerage.complaint.resolved",
  complaintClosed: "sewerage.complaint.closed",
  desludgingBooked: "sewerage.desludging.booked",
  desludgingScheduled: "sewerage.desludging.scheduled",
  desludgingDispatched: "sewerage.desludging.dispatched",
  desludgingCompleted: "sewerage.desludging.completed",
  desludgingCancelled: "sewerage.desludging.cancelled",
  fieldRecordCreated: "sewerage.field_record.created",
} as const;

export const CONSUMED_EVENTS = {} as const;
export const AUDIT_TOPIC = "audit.event.record";
export const SERVICE = "sewerage";
