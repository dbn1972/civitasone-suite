/**
 * SVC-082 / FN-24 — pure intake domain helpers (no I/O, unit-tested).
 *
 * Channel attribution + acknowledgement tracking-number generation for online
 * and assisted-service intake. FN-24 enforces the published catalogue channel
 * allow-list at draft save and submit. FN-23 applicant-type gating is delegated
 * to applicant-identity/domain.
 */
import { randomBytes } from "node:crypto";
import {
  assertApplicantTypeAllowed,
  coerceAllowedApplicantTypes,
  normalizeApplicantType,
  type ApplicantType,
  ApplicantTypeRejectedError,
} from "../applicant-identity/domain.js";

/** Intake + catalogue channel vocabulary (FN-24 / B1 designer). */
export const INTAKE_CHANNELS = ["portal", "counter", "mobile", "assisted", "whatsapp", "api"] as const;
export type IntakeChannel = typeof INTAKE_CHANNELS[number];

export { ApplicantTypeRejectedError };

/** Channels that represent operator-on-behalf-of (assisted) entry. */
const ASSISTED_CHANNELS: IntakeChannel[] = ["counter", "assisted"];

export function isAssistedChannel(channel: IntakeChannel): boolean {
  return ASSISTED_CHANNELS.includes(channel);
}

/** True when the intake channel is in the service's published allow-list. */
export function isChannelAllowed(channel: string, allowedChannels: readonly string[]): boolean {
  return allowedChannels.includes(channel);
}

/**
 * FN-24 — reject intake when the chosen channel is not enabled on the published
 * service definition. Throws `CHANNEL_NOT_ALLOWED`.
 */
export function assertChannelAllowed(channel: string, allowedChannels: readonly string[]): void {
  if (isChannelAllowed(channel, allowedChannels)) return;
  throw new Error("CHANNEL_NOT_ALLOWED");
}

/** Clear, applicant-facing explanation for a CHANNEL_NOT_ALLOWED rejection. */
export function channelNotAllowedMessage(channel: string, allowedChannels: readonly string[]): string {
  const allowed = allowedChannels.length > 0 ? allowedChannels.join(", ") : "none";
  return `This service does not accept applications via the ${channel} channel. Allowed channels: ${allowed}.`;
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

/**
 * Resolve + gate applicant type against the service definition (FN-23).
 * Defaults to `citizen` when the client omits a type (legacy clients).
 */
export function resolveAndGateApplicantType(input: {
  rawApplicantType?: string | null | undefined;
  allowedApplicantTypes?: unknown;
  rejectMessage?: string | null | undefined;
}): ApplicantType {
  const applicantType = normalizeApplicantType(input.rawApplicantType ?? "citizen") ?? "citizen";
  assertApplicantTypeAllowed({
    allowedApplicantTypes: coerceAllowedApplicantTypes(input.allowedApplicantTypes),
    applicantType,
    rejectMessage: input.rejectMessage,
  });
  return applicantType;
}
