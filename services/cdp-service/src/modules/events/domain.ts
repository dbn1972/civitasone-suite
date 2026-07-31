/**
 * events/domain.ts — Consent validation and event ingestion logic.
 * Checks if a profile has consented for a particular event type before ingestion.
 */

/** Consent categories that gate event ingestion. */
export type ConsentCategory = "marketing" | "analytics" | "transactional" | "communication";

/**
 * Map event types to required consent categories.
 * Transactional events are always allowed (no consent needed).
 */
export function requiredConsent(eventType: string): ConsentCategory | null {
  if (eventType.startsWith("marketing.") || eventType.startsWith("campaign.")) {
    return "marketing";
  }
  if (eventType.startsWith("analytics.") || eventType.startsWith("tracking.")) {
    return "analytics";
  }
  if (eventType.startsWith("notification.") || eventType.startsWith("comm.")) {
    return "communication";
  }
  // Transactional events (order, payment, login, etc.) do not require consent
  return null;
}

/**
 * Validate that a profile has consented to receive this event type.
 * If no consent is required (transactional), returns true.
 * consentFlags is the profile's consent map (e.g., { marketing: true, analytics: false }).
 */
export function validateConsent(
  eventType: string,
  consentFlags: Record<string, boolean> | undefined,
): { allowed: boolean; reason?: string } {
  const category = requiredConsent(eventType);
  if (category === null) {
    return { allowed: true };
  }
  if (!consentFlags) {
    return { allowed: false, reason: `consent record missing; ${category} consent required` };
  }
  if (consentFlags[category] !== true) {
    return { allowed: false, reason: `profile has not consented to ${category} events` };
  }
  return { allowed: true };
}

/**
 * Validate a batch of events. Returns indices of rejected events with reasons.
 */
export function validateBatchConsent(
  events: Array<{ eventType: string; profileConsent?: Record<string, boolean> }>,
): Array<{ index: number; reason: string }> {
  const rejections: Array<{ index: number; reason: string }> = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    const result = validateConsent(ev.eventType, ev.profileConsent);
    if (!result.allowed) {
      rejections.push({ index: i, reason: result.reason ?? "consent denied" });
    }
  }
  return rejections;
}

/**
 * Maximum batch size for event ingestion.
 */
export const MAX_BATCH_SIZE = 100;
