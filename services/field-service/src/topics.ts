/** Topic + event names owned by field-service. {service}.{entity}.{action} */
export const COMMANDS = {
  /** Create a field task assignment. */
  taskCreate: "field.task.create",
  /** Update a field task (reassign, reschedule). */
  taskUpdate: "field.task.update",
  /** Assign a task to a field agent. */
  taskAssign: "field.task.assign",
  /** Start work on a task. */
  taskStart: "field.task.start",
  /** Mark a task as completed. */
  taskComplete: "field.task.complete",
  /** Cancel a task. */
  taskCancel: "field.task.cancel",
  /** Delete (soft-cancel) a task. */
  taskDelete: "field.task.delete",
  /** Record a visit check-in at a location. */
  visitCheckIn: "field.visit.check_in",
  /** Record a visit check-out with notes/photos. */
  visitCheckOut: "field.visit.check_out",
  /** Create + optimize a route for a given day. */
  routeCreate: "field.route.create",
  /** Manually reorder an existing route's waypoints. */
  routeReorder: "field.route.reorder",
  /** Batch push of offline operations from a field device. */
  syncPush: "field.sync.push",
} as const;

export const EVENTS = {
  /** A field task was created and assigned. */
  taskCreated: "field.task.created",
  /** A field task was assigned to an agent. */
  taskAssigned: "field.task.assigned",
  /** A field task was started. */
  taskStarted: "field.task.started",
  /** A field task was completed. */
  taskCompleted: "field.task.completed",
  /** A field task was cancelled. */
  taskCancelled: "field.task.cancelled",
  /** A field task was deleted. */
  taskDeleted: "field.task.deleted",
  /** A field agent checked in at a location. */
  visitCheckedIn: "field.visit.checked_in",
  /** A field agent checked out from a location. */
  visitCheckedOut: "field.visit.checked_out",
  /** A route was created and optimized for a given day. */
  routeCreated: "field.route.created",
  /** A route's waypoints were manually reordered. */
  routeReordered: "field.route.reordered",
  /** Offline sync batch processed successfully. */
  syncCompleted: "field.sync.completed",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const AUDIT_TOPIC = "audit.event.record";
export const SERVICE = "field";
export const RESOURCE = "task";
