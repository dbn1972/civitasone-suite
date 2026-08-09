export const COMMANDS = {
  complaintCreate: "drainage.complaint.create",
  complaintAssign: "drainage.complaint.assign",
  complaintResolve: "drainage.complaint.resolve",
  complaintClose: "drainage.complaint.close",
  fieldActionCreate: "drainage.field_action.create",
  hotspotIdentify: "drainage.hotspot.identify",
  hotspotUpdateStatus: "drainage.hotspot.update_status",
  hotspotResolve: "drainage.hotspot.resolve",
} as const;

export const EVENTS = {
  complaintCreated: "drainage.complaint.created",
  complaintAssigned: "drainage.complaint.assigned",
  complaintResolved: "drainage.complaint.resolved",
  complaintClosed: "drainage.complaint.closed",
  fieldActionCreated: "drainage.field_action.created",
  hotspotIdentified: "drainage.hotspot.identified",
  hotspotStatusUpdated: "drainage.hotspot.status_updated",
  hotspotResolved: "drainage.hotspot.resolved",
} as const;

export const CONSUMED_EVENTS = {} as const;
export const AUDIT_TOPIC = "audit.event.record";
export const SERVICE = "drainage";
