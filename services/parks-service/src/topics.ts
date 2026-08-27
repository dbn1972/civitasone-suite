export const SERVICE = "parks" as const;

export const COMMANDS = {
  CREATE_COMPLAINT:       "parks.complaint.create",
  ACKNOWLEDGE_COMPLAINT:  "parks.complaint.acknowledge",
  ASSIGN_COMPLAINT:       "parks.complaint.assign",
  RESOLVE_COMPLAINT:      "parks.complaint.resolve",
  CLOSE_COMPLAINT:        "parks.complaint.close",

  CREATE_TREE_REQUEST:    "parks.tree_request.create",
  INSPECT_TREE_REQUEST:   "parks.tree_request.inspect",
  APPROVE_TREE_REQUEST:   "parks.tree_request.approve",
  REJECT_TREE_REQUEST:    "parks.tree_request.reject",
  COMPLETE_TREE_REQUEST:  "parks.tree_request.complete",

  SCHEDULE_INSPECTION:    "parks.inspection.schedule",
  COMPLETE_INSPECTION:    "parks.inspection.complete",

  CREATE_ASSET:           "parks.asset.create",
  UPDATE_ASSET:           "parks.asset.update",
  RECORD_MAINTENANCE:     "parks.asset.record_maintenance",
} as const;

export const EVENTS = {
  COMPLAINT_CREATED:      "parks.complaint.created",
  COMPLAINT_ACKNOWLEDGED: "parks.complaint.acknowledged",
  COMPLAINT_ASSIGNED:     "parks.complaint.assigned",
  COMPLAINT_RESOLVED:     "parks.complaint.resolved",
  COMPLAINT_CLOSED:       "parks.complaint.closed",

  TREE_REQUEST_CREATED:   "parks.tree_request.created",
  TREE_REQUEST_INSPECTED: "parks.tree_request.inspected",
  TREE_REQUEST_APPROVED:  "parks.tree_request.approved",
  TREE_REQUEST_REJECTED:  "parks.tree_request.rejected",
  TREE_REQUEST_COMPLETED: "parks.tree_request.completed",

  INSPECTION_SCHEDULED:   "parks.inspection.scheduled",
  INSPECTION_COMPLETED:   "parks.inspection.completed",

  ASSET_CREATED:          "parks.asset.created",
  ASSET_UPDATED:          "parks.asset.updated",
  MAINTENANCE_RECORDED:   "parks.asset.maintenance_recorded",
} as const;

export const CONSUMED_EVENTS = {} as const;
