/**
 * SVC-082 — pure intake domain helpers (no I/O, unit-tested).
 *
 * Channel attribution + acknowledgement tracking-number generation for online
 * and assisted-service intake.
 */
import { randomBytes } from "node:crypto";

export const INTAKE_CHANNELS = ["portal", "counter", "mobile", "assisted"] as const;
export type IntakeChannel = typeof INTAKE_CHANNELS[number];

/** Channels that represent operator-on-behalf-of (assisted) entry. */
const ASSISTED_CHANNELS: IntakeChannel[] = ["counter", "assisted"];

export function isAssistedChannel(channel: IntakeChannel): boolean {
  return ASSISTED_CHANNELS.includes(channel);
}

/**
 * A unique, human-readable tracking number for the acknowledgement.
 * Format: CIT-{YYYY}-{8 hex}. The random suffix is unique per acknowledgement;
 * the DB carries a UNIQUE(tenant, tracking_no) index as the hard guarantee.
 */
export function buildTrackingNumber(now: Date = new Date()): string {
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `CIT-${now.getUTCFullYear()}-${suffix}`;
}

/**
 * Validate that an assisted/counter channel carries an operator id, and that a
 * self-service channel does NOT smuggle one. Returns the operator id to persist.
 */
export function resolveAssistedBy(channel: IntakeChannel, operatorId: string | undefined): string | null {
  if (isAssistedChannel(channel)) {
    if (!operatorId) throw new Error("ASSISTED_OPERATOR_REQUIRED");
    return operatorId;
  }
  return null;
}
