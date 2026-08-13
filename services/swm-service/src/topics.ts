export const COMMANDS = {
  complaintCreate: "swm.complaint.create",
  complaintAssign: "swm.complaint.assign",
  complaintResolve: "swm.complaint.resolve",
  complaintClose: "swm.complaint.close",
  bulkGeneratorRegister: "swm.bulk_generator.register",
  bulkGeneratorUpdate: "swm.bulk_generator.update",
  bulkGeneratorSuspend: "swm.bulk_generator.suspend",
  collectionRequest: "swm.collection.request",
  collectionSchedule: "swm.collection.schedule",
  collectionComplete: "swm.collection.complete",
  collectionCancel: "swm.collection.cancel",
  fieldTaskCreate: "swm.field_task.create",
  fieldTaskComplete: "swm.field_task.complete",
  hotspotIdentify: "swm.hotspot.identify",
  hotspotResolve: "swm.hotspot.resolve",
} as const;

export const EVENTS = {
  complaintCreated: "swm.complaint.created",
  complaintAssigned: "swm.complaint.assigned",
  complaintResolved: "swm.complaint.resolved",
  complaintClosed: "swm.complaint.closed",
  bulkGeneratorRegistered: "swm.bulk_generator.registered",
  bulkGeneratorUpdated: "swm.bulk_generator.updated",
  bulkGeneratorSuspended: "swm.bulk_generator.suspended",
  collectionRequested: "swm.collection.requested",
  collectionScheduled: "swm.collection.scheduled",
  collectionCompleted: "swm.collection.completed",
  collectionCancelled: "swm.collection.cancelled",
  fieldTaskCreated: "swm.field_task.created",
  fieldTaskCompleted: "swm.field_task.completed",
  hotspotIdentified: "swm.hotspot.identified",
  hotspotResolved: "swm.hotspot.resolved",
} as const;

export const CONSUMED_EVENTS = {} as const;
export const AUDIT_TOPIC = "audit.event.record";
export const SERVICE = "swm";
