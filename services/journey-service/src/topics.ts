/** Topic + event names owned by journey-service. {service}.{entity}.{action} */
export const COMMANDS = {
  /** Create a new multi-step campaign journey definition. */
  journeyCreate: "journey.journey.create",
  /** Activate a journey — starts enrollment of matching profiles. */
  journeyActivate: "journey.journey.activate",
  /** Execute a single step for an enrolled profile. */
  stepExecute: "journey.step.execute",
} as const;

export const EVENTS = {
  /** A journey has been activated and is enrolling profiles. */
  journeyStarted: "journey.journey.started",
  /** A single step within a journey has been completed for a profile. */
  stepCompleted: "journey.step.completed",
  /** A profile has completed all steps of a journey. */
  journeyCompleted: "journey.journey.completed",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "journey";
export const RESOURCE = "journey";
