/**
 * Telemetry / IoT domain — pure functions for alert rule evaluation,
 * device state management, and rule matching.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 * Alert evaluation is pure (no side effects).
 *
 * _Requirements: SVC-110_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid device states. */
export const DEVICE_STATES = ["active", "inactive", "maintenance"] as const;
export type DeviceState = typeof DEVICE_STATES[number];

/** Valid alert states and permitted transitions. */
export const ALERT_STATES = ["open", "acknowledged", "resolved", "finding_created"] as const;
export type AlertState = typeof ALERT_STATES[number];

/** Permitted alert state transitions: open → acknowledged → resolved|finding_created */
export const ALERT_TRANSITIONS: Record<AlertState, AlertState[]> = {
  open:             ["acknowledged"],
  acknowledged:     ["resolved", "finding_created"],
  resolved:         [],
  finding_created:  [],
};

export type AlertOperator = "gt" | "lt" | "gte" | "lte" | "eq";
export type AlertSeverity = "critical" | "major" | "minor";
export type DeviceType = "sensor" | "drone" | "camera" | "iot_gateway";
export type AlertType = "threshold_exceeded" | "anomaly" | "offline";

export interface Reading {
  value: number;
  readingType: string;
  deviceType: string;
}

export interface AlertRule {
  id: string;
  deviceType: string;
  readingType: string;
  operator: AlertOperator;
  thresholdValue: number;
  severity: AlertSeverity;
  isActive: boolean;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Evaluate a single alert rule against a reading.
 * Returns true if the rule condition is met (alert should fire).
 *
 * @param reading - The telemetry reading to evaluate.
 * @param rule - The alert rule to check against.
 * @returns true if the rule condition is satisfied.
 */
export function evaluateAlertRule(reading: Reading, rule: AlertRule): boolean {
  if (!rule.isActive) return false;
  if (rule.deviceType !== reading.deviceType) return false;
  if (rule.readingType !== reading.readingType) return false;

  const value = reading.value;
  const threshold = rule.thresholdValue;

  switch (rule.operator) {
    case "gt":  return value > threshold;
    case "lt":  return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    case "eq":  return value === threshold;
    default:    return false;
  }
}

/**
 * Match all applicable alert rules for a given reading.
 * Returns all rules whose conditions are met.
 *
 * @param reading - The telemetry reading.
 * @param rules - All available alert rules.
 * @returns Array of matching rules.
 */
export function matchAlertRules(reading: Reading, rules: AlertRule[]): AlertRule[] {
  return rules.filter((rule) => evaluateAlertRule(reading, rule));
}

/**
 * Assert that a device is in active state. Throws if not active.
 *
 * @param status - The current device status.
 * @throws {DomainError} with code `DEVICE_NOT_ACTIVE`
 */
export function assertDeviceActive(status: string): void {
  if (status !== "active") {
    throw new DomainError(
      "DEVICE_NOT_ACTIVE",
      `Device is not active (current status: '${status}'). Cannot ingest readings from inactive or maintenance devices`,
    );
  }
}

/**
 * Assert that an alert state transition is valid.
 *
 * @param current - The current alert state.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION`
 */
export function assertValidAlertTransition(
  current: AlertState,
  target: AlertState,
): void {
  const allowed = ALERT_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition alert from '${current}' to '${target}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}
