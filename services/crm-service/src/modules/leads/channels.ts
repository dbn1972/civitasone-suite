/**
 * The service's ONE channel vocabulary (LM-005).
 *
 * These codes were declared inline in `inbound-routes.ts` (the inbound lead-capture
 * route) and are persisted on `crm.contacts.capture_channel`. They were lifted into
 * their own module — not copied — when segment definitions needed to validate their
 * primary channels (G5): a second list would have drifted the moment either side
 * gained a channel, and a segment could then name a channel no lead can arrive on.
 *
 * Anything that needs to name a channel imports from here. Adding a code is a
 * one-line change plus the matching CHECK constraint in the segment-definitions
 * migration (`crm.segment_definitions.primary_channels`).
 */
export const LEAD_CHANNELS = [
  "email",
  "telephony",
  "chatbot",
  "whatsapp",
  "partner_api",
  "campaign",
] as const;

export type LeadChannel = (typeof LEAD_CHANNELS)[number];

/** True when `value` is one of the known channel codes. */
export function isLeadChannel(value: unknown): value is LeadChannel {
  return typeof value === "string" && (LEAD_CHANNELS as readonly string[]).includes(value);
}
