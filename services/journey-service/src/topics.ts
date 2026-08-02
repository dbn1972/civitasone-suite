/** Topic + event names owned by journey-service. {service}.{entity}.{action} */
export const COMMANDS = {
  /** Create a new multi-step campaign journey definition. */
  journeyCreate: "journey.journey.create",
  /** Update a draft journey's name, steps, or trigger config. */
  journeyUpdate: "journey.journey.update",
  /** Activate a journey — starts enrollment of matching profiles. */
  journeyActivate: "journey.journey.activate",
  /** Pause an active journey. */
  journeyPause: "journey.journey.pause",
  /** Archive (soft-delete) a journey. */
  journeyDelete: "journey.journey.delete",
  /** Create a trigger definition for a journey. */
  triggerCreate: "journey.trigger.create",
  /** Update a trigger definition. */
  triggerUpdate: "journey.trigger.update",
  /** Soft-delete (deactivate) a trigger definition. */
  triggerDelete: "journey.trigger.delete",
  /** Execute a single step for an enrolled profile. */
  stepExecute: "journey.step.execute",
  /** Enroll a profile into an active journey. */
  executionEnroll: "journey.execution.enroll",
} as const;

export const EVENTS = {
  /** A journey definition was created. */
  journeyCreated: "journey.journey.created",
  /** A journey definition was updated. */
  journeyUpdated: "journey.journey.updated",
  /** A journey has been activated and is enrolling profiles. */
  journeyStarted: "journey.journey.started",
  /** A journey was paused. */
  journeyPaused: "journey.journey.paused",
  /** A journey was archived (soft-deleted). */
  journeyArchived: "journey.journey.archived",
  /** A single step within a journey has been completed for a profile. */
  stepCompleted: "journey.step.completed",
  /** A profile has completed all steps of a journey. */
  journeyCompleted: "journey.journey.completed",
  /** A trigger definition was created. */
  triggerCreated: "journey.trigger.created",
  /** A trigger definition was updated. */
  triggerUpdated: "journey.trigger.updated",
  /** A trigger definition was deactivated. */
  triggerDeleted: "journey.trigger.deleted",
  /** A profile was enrolled into a journey. */
  executionEnrolled: "journey.execution.enrolled",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "journey";
export const RESOURCE = "journey";
