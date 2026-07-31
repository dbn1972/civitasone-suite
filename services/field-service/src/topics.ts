/** Topic + event names owned by field-service. {service}.{entity}.{action} */
export const COMMANDS = {
  /** Create a field task assignment. */
  taskCreate: "field.task.create",
  /** Update a field task (reassign, reschedule). */
  taskUpdate: "field.task.update",
  /** Record a visit check-in at a location. */
  visitCheckIn: "field.visit.check_in",
  /** Record a visit check-out with notes/photos. */
  visitCheckOut: "field.visit.check_out",
  /** Optimize a route for a given day. */
  routeOptimize: "field.route.optimize",
  /** Batch sync from offline device. */
  syncBatch: "field.sync.batch",
} as const;

export const EVENTS = {
  /** A field task was created and assigned. */
  taskCreated: "field.task.created",
  /** A field task was completed. */
  taskCompleted: "field.task.completed",
  /** A field agent checked in at a location. */
  visitCheckedIn: "field.visit.checked_in",
  /** A field agent checked out from a location. */
  visitCheckedOut: "field.visit.checked_out",
  /** A route was optimized for a given day. */
  routeOptimized: "field.route.optimized",
  /** Offline sync batch processed successfully. */
  syncCompleted: "field.sync.completed",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "field";
export const RESOURCE = "task";
