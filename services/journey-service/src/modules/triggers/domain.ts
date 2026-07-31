/**
 * triggers/domain.ts — Trigger type validation and matching logic.
 *
 * Trigger types: event_based, time_based, segment_entry
 * Each type has specific config requirements.
 */

export type TriggerType = "event_based" | "time_based" | "segment_entry";
export type TriggerStatus = "active" | "paused";

const VALID_TRIGGER_TYPES: TriggerType[] = ["event_based", "time_based", "segment_entry"];

/**
 * Validate trigger type.
 */
export function validateTriggerType(triggerType: string): string | null {
  if (!VALID_TRIGGER_TYPES.includes(triggerType as TriggerType)) {
    return `invalid trigger type '${triggerType}'; must be one of: ${VALID_TRIGGER_TYPES.join(", ")}`;
  }
  return null;
}

/**
 * Validate trigger config based on type.
 * Each type has specific required fields.
 */
export function validateTriggerConfig(triggerType: TriggerType, config: Record<string, unknown>): string | null {
  switch (triggerType) {
    case "event_based":
      if (!config["eventName"] || typeof config["eventName"] !== "string") {
        return "event_based trigger requires 'eventName' in config";
      }
      break;
    case "time_based":
      if (!config["schedule"] || typeof config["schedule"] !== "string") {
        return "time_based trigger requires 'schedule' (cron expression) in config";
      }
      break;
    case "segment_entry":
      if (!config["segmentId"] || typeof config["segmentId"] !== "string") {
        return "segment_entry trigger requires 'segmentId' in config";
      }
      break;
  }
  return null;
}

/**
 * Check if an incoming event matches a trigger definition.
 */
export function matchesEvent(
  trigger: { triggerType: TriggerType; config: Record<string, unknown>; status: TriggerStatus },
  event: { eventName: string; payload?: Record<string, unknown> },
): boolean {
  if (trigger.status !== "active") return false;
  if (trigger.triggerType !== "event_based") return false;
  return trigger.config["eventName"] === event.eventName;
}

/**
 * Check if a segment entry event matches a trigger definition.
 */
export function matchesSegmentEntry(
  trigger: { triggerType: TriggerType; config: Record<string, unknown>; status: TriggerStatus },
  segmentId: string,
): boolean {
  if (trigger.status !== "active") return false;
  if (trigger.triggerType !== "segment_entry") return false;
  return trigger.config["segmentId"] === segmentId;
}
