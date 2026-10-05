/**
 * Single source of truth for CRM activity types on the Interactions screen.
 *
 * These MUST stay in sync with the crm-service create enum
 * (services/crm-service/src/modules/activities/validators.ts ACTIVITY_TYPES:
 * task, call, meeting, appointment, note, reminder, email, complaint) and with
 * the shared CRMActivityEntry['type'] union / CRMActivityEntrySchema in
 * @civitasone/types + @civitasone/schemas. The old form offered "site_visit",
 * which the backend rejects (400) — logging one silently failed — and the list
 * mapper only accepted five of the eight valid types, so a saved appointment /
 * reminder / complaint was silently dropped from the table and every stat
 * (GAP-CRM-ACTIVITIES-01).
 */

/** Every activity type the backend list endpoint can return and the mapper accepts. */
export const ACTIVITY_TYPES = [
  "call",
  "meeting",
  "email",
  "task",
  "note",
  "appointment",
  "reminder",
  "complaint",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * Humanised labels live in the `crmActivityTypes` message namespace, keyed by
 * the raw backend value (so every ActivityType is also a message key).
 */

/**
 * Types offered in the "Log an interaction" form. A subset of ACTIVITY_TYPES:
 * every value here is accepted by the create endpoint. "complaint" is omitted
 * because logging one opens a helpdesk case (a separate, deliberate flow), not
 * a plain interaction; it is still rendered in the list if the backend returns
 * one.
 */
export const LOGGABLE_ACTIVITY_TYPES = [
  "call",
  "meeting",
  "email",
  "task",
  "note",
  "appointment",
  "reminder",
] as const satisfies readonly ActivityType[];

/** True when `type` is one of the known backend activity types. */
export function isActivityType(type: string): type is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(type);
}

/**
 * Humanise a raw type for display via the `crmActivityTypes` translator `t`,
 * falling back to the raw value for an unknown type.
 */
export function activityTypeLabel(type: string, t: (key: ActivityType) => string): string {
  return isActivityType(type) ? t(type) : type;
}
