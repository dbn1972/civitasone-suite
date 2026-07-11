/**
 * visitor-service: device-registry — pure domain logic.
 *
 * Owns:
 *   - Device status state machine (pending_activation → active → suspended → deregistered)
 *   - Device token generation and hashing (48-byte random, base64url, SHA-256)
 *   - Auth type resolution based on device type (mTLS for high-security, bearer for others)
 *   - Rate limit resolution per device type
 *   - Firmware version comparison (semver-like)
 *   - Token expiration and rotation grace period checks
 *   - Device type constants and classification helpers
 *   - Heartbeat timeout constants
 *
 * All functions are pure (no side effects, no DB/Redis calls). Crypto operations
 * use Node.js built-in `crypto` module for deterministic hashing and secure randomness.
 *
 * Requirements validated: 1.1, 1.6, 1.7, 1.9, 2.4, 2.7, 3.7, 10.8
 */
import { randomBytes, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Device Type Constants
// ---------------------------------------------------------------------------

/** All supported device types in the hardware integration module. */
export const DEVICE_TYPES = ["kiosk", "printer", "scanner", "turnstile", "barrier"] as const;

/** A device type string literal union. */
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** High-security device types requiring mTLS authentication. */
export const HIGH_SECURITY_TYPES: DeviceType[] = ["turnstile", "barrier"];

/** Low-security device types using Bearer token authentication. */
export const LOW_SECURITY_TYPES: DeviceType[] = ["kiosk", "printer", "scanner"];

/**
 * Check whether a device type is classified as high-security.
 * High-security devices (turnstiles, barriers) use mTLS and have higher rate limits.
 */
export function isHighSecurityDevice(deviceType: string): boolean {
  return HIGH_SECURITY_TYPES.includes(deviceType as DeviceType);
}

// ---------------------------------------------------------------------------
// Device Status State Machine
// ---------------------------------------------------------------------------

/** Valid device lifecycle states. */
export type DeviceStatus = "pending_activation" | "active" | "suspended" | "deregistered";

/**
 * Allowed state transitions for device lifecycle.
 * - pending_activation → active (device activated) or deregistered (cancelled before use)
 * - active → suspended (admin suspends) or deregistered (admin removes)
 * - suspended → active (admin reactivates) or deregistered (admin removes)
 * - deregistered → (terminal state, no further transitions)
 */
export const DEVICE_TRANSITIONS: Record<DeviceStatus, DeviceStatus[]> = {
  pending_activation: ["active", "deregistered"],
  active: ["suspended", "deregistered"],
  suspended: ["active", "deregistered"],
  deregistered: [], // terminal state
};

/**
 * Determine whether a state transition is valid for a device.
 *
 * @param from - Current device status
 * @param to - Desired target status
 * @returns true if the transition is allowed by the state machine
 */
export function canTransition(from: DeviceStatus, to: DeviceStatus): boolean {
  const allowed = DEVICE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Token Generation
// ---------------------------------------------------------------------------

/**
 * Generate a new device authentication token.
 *
 * Produces a cryptographically secure 48-byte random value encoded as base64url
 * with a "device_" prefix. The corresponding SHA-256 hex hash is returned for
 * storage (the raw token is given to the device and never stored server-side).
 *
 * @returns Object containing the raw token (for the device) and its SHA-256 hash (for storage)
 */
export function generateDeviceToken(): { token: string; hash: string } {
  const bytes = randomBytes(48);
  const encoded = bytes.toString("base64url");
  const token = `device_${encoded}`;
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

// ---------------------------------------------------------------------------
// Auth Type Resolution
// ---------------------------------------------------------------------------

/**
 * Determine the authentication type required for a given device type.
 *
 * - Turnstiles and barriers require mutual TLS (client certificates).
 * - All other device types use Bearer token authentication.
 *
 * @param deviceType - The device type string
 * @returns The authentication method for the device
 */
export function getAuthType(deviceType: string): "bearer_token" | "mtls" {
  return isHighSecurityDevice(deviceType) ? "mtls" : "bearer_token";
}

// ---------------------------------------------------------------------------
// Rate Limit Resolution
// ---------------------------------------------------------------------------

/**
 * Get the per-device rate limit (requests per minute) for a given device type.
 *
 * - Turnstiles and barriers: 120 req/min (higher throughput for access control)
 * - All other devices: 60 req/min
 *
 * @param deviceType - The device type string
 * @returns Maximum requests per minute allowed for the device
 */
export function getRateLimit(deviceType: string): number {
  return isHighSecurityDevice(deviceType) ? 120 : 60;
}

// ---------------------------------------------------------------------------
// Firmware Version Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two semver-like version strings to determine if the current
 * firmware is outdated (below the minimum required version).
 *
 * Compares major, minor, and patch components numerically from left to right.
 * Missing components default to 0 (e.g., "1.2" is treated as "1.2.0").
 *
 * @param current - The device's currently reported firmware version (e.g., "1.2.3")
 * @param minimum - The minimum required firmware version (e.g., "1.3.0")
 * @returns true if current version is strictly below the minimum
 */
export function isFirmwareOutdated(current: string, minimum: string): boolean {
  const parseParts = (v: string): number[] =>
    v.split(".").map((p) => {
      const n = parseInt(p, 10);
      return Number.isNaN(n) ? 0 : n;
    });

  const currentParts = parseParts(current);
  const minimumParts = parseParts(minimum);

  const maxLen = Math.max(currentParts.length, minimumParts.length);

  for (let i = 0; i < maxLen; i++) {
    const c = currentParts[i] ?? 0;
    const m = minimumParts[i] ?? 0;
    if (c < m) return true;
    if (c > m) return false;
  }

  return false; // versions are equal
}

// ---------------------------------------------------------------------------
// Token Verification Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a device token has expired.
 *
 * A null expiresAt means the token never expires (returns false).
 *
 * @param expiresAt - Token expiration timestamp, or null for non-expiring tokens
 * @param now - Current time (injectable for deterministic testing)
 * @returns true if the token has expired
 */
export function isTokenExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

/** Default grace period for Bearer token rotation: 24 hours. */
export const BEARER_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** Default grace period for mTLS certificate rotation: 7 days. */
export const MTLS_ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Check whether a device is currently within the credential rotation grace period.
 *
 * During rotation, both the old and new credentials are accepted for a configurable
 * window: 24 hours for Bearer tokens, 7 days for certificates.
 *
 * A null rotatedAt means no rotation is in progress (returns false).
 *
 * @param rotatedAt - Timestamp when the credential was rotated, or null
 * @param gracePeriodMs - Duration of the grace period in milliseconds
 *   (defaults to 24h for bearer tokens; callers should pass MTLS_ROTATION_GRACE_MS for certificates)
 * @param now - Current time (injectable for deterministic testing)
 * @returns true if currently within the rotation grace period
 */
export function isInRotationGracePeriod(
  rotatedAt: Date | null,
  gracePeriodMs: number = BEARER_ROTATION_GRACE_MS,
  now: Date = new Date(),
): boolean {
  if (!rotatedAt) return false;
  const graceEnd = rotatedAt.getTime() + gracePeriodMs;
  return now.getTime() < graceEnd;
}

// ---------------------------------------------------------------------------
// Heartbeat Timeout Constants
// ---------------------------------------------------------------------------

/** Expected heartbeat interval from active devices (30 seconds). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * TTL for the device's online status in Redis (90 seconds).
 * If 3 consecutive heartbeats are missed, the device is considered offline.
 */
export const HEARTBEAT_TTL_SECONDS = 90;

/**
 * Delay before generating a critical alert for an offline device (2 minutes).
 * After this period without a heartbeat, facility operations are alerted.
 */
export const OFFLINE_ALERT_DELAY_MS = 120_000;
