/**
 * G22 — Context-attach domain logic (pure functions).
 *
 * The rule engine processes inbound events and determines which CRM entity
 * they should be attached to based on configurable matching rules.
 */

export interface ContextAttachRule {
  id: string;
  tenantId: string;
  eventType: string;
  matchField: string;
  matchTarget: string;
  targetField: string;
  action: string;
  active: boolean;
  priority: number;
}

export interface InboundEvent {
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ResolvedTarget {
  type: string;
  id: string;
}

/**
 * Find the first matching rule for an inbound event, ordered by priority (ascending).
 * Only active rules whose event_type matches the event are considered.
 */
export function matchRule(event: InboundEvent, rules: ContextAttachRule[]): ContextAttachRule | null {
  const candidates = rules
    .filter((r) => r.active && r.eventType === event.eventType)
    .sort((a, b) => a.priority - b.priority);
  return candidates[0] ?? null;
}

/**
 * Extract the match value from the event payload using the rule's matchField.
 * Supports dot-notation for nested fields (e.g. "data.sourceRef").
 * Returns null if the field is missing or not a string.
 */
export function extractMatchValue(event: InboundEvent, matchField: string): string | null {
  const parts = matchField.split(".");
  let current: unknown = event.payload;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "string") return current;
  if (typeof current === "number") return String(current);
  return null;
}

/**
 * Contract for target resolution. The actual DB lookup is performed by the consumer;
 * this function defines what a resolved target looks like given the inputs.
 * Returns a target descriptor or null if resolution failed.
 */
export function buildTargetDescriptor(
  matchValue: string,
  targetType: string,
  targetId: string,
): ResolvedTarget {
  return { type: targetType, id: targetId };
}

/** Allowed match targets for validation. */
export const MATCH_TARGETS = ["account", "contact", "deal", "case"] as const;
export type MatchTarget = (typeof MATCH_TARGETS)[number];

/** Allowed actions for validation. */
export const ACTIONS = ["link_activity", "link_document", "create_task"] as const;
export type Action = (typeof ACTIONS)[number];
