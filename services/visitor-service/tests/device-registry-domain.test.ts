/**
 * Unit tests for device-registry domain logic.
 *
 * Tests cover: state machine transitions, token generation, auth type resolution,
 * rate limits, firmware comparison, token expiration, rotation grace period,
 * device type classification, and heartbeat constants.
 */
import { describe, it, expect } from "vitest";
import {
  DEVICE_TYPES,
  HIGH_SECURITY_TYPES,
  LOW_SECURITY_TYPES,
  isHighSecurityDevice,
  DeviceStatus,
  DEVICE_TRANSITIONS,
  canTransition,
  generateDeviceToken,
  getAuthType,
  getRateLimit,
  isFirmwareOutdated,
  isTokenExpired,
  isInRotationGracePeriod,
  BEARER_ROTATION_GRACE_MS,
  MTLS_ROTATION_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TTL_SECONDS,
  OFFLINE_ALERT_DELAY_MS,
} from "../src/modules/device-registry/domain.js";

// ---------------------------------------------------------------------------
// Device Type Constants
// ---------------------------------------------------------------------------

describe("Device type constants", () => {
  it("defines all 5 device types", () => {
    expect(DEVICE_TYPES).toEqual(["kiosk", "printer", "scanner", "turnstile", "barrier"]);
  });

  it("classifies turnstile and barrier as high-security", () => {
    expect(HIGH_SECURITY_TYPES).toEqual(["turnstile", "barrier"]);
  });

  it("classifies kiosk, printer, scanner as low-security", () => {
    expect(LOW_SECURITY_TYPES).toEqual(["kiosk", "printer", "scanner"]);
  });

  it("isHighSecurityDevice returns true for turnstile and barrier", () => {
    expect(isHighSecurityDevice("turnstile")).toBe(true);
    expect(isHighSecurityDevice("barrier")).toBe(true);
  });

  it("isHighSecurityDevice returns false for kiosk, printer, scanner", () => {
    expect(isHighSecurityDevice("kiosk")).toBe(false);
    expect(isHighSecurityDevice("printer")).toBe(false);
    expect(isHighSecurityDevice("scanner")).toBe(false);
  });

  it("isHighSecurityDevice returns false for unknown types", () => {
    expect(isHighSecurityDevice("unknown")).toBe(false);
    expect(isHighSecurityDevice("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Device Status State Machine
// ---------------------------------------------------------------------------

describe("Device status state machine", () => {
  it("allows pending_activation → active", () => {
    expect(canTransition("pending_activation", "active")).toBe(true);
  });

  it("allows pending_activation → deregistered", () => {
    expect(canTransition("pending_activation", "deregistered")).toBe(true);
  });

  it("does not allow pending_activation → suspended", () => {
    expect(canTransition("pending_activation", "suspended")).toBe(false);
  });

  it("allows active → suspended", () => {
    expect(canTransition("active", "suspended")).toBe(true);
  });

  it("allows active → deregistered", () => {
    expect(canTransition("active", "deregistered")).toBe(true);
  });

  it("does not allow active → pending_activation", () => {
    expect(canTransition("active", "pending_activation")).toBe(false);
  });

  it("allows suspended → active (reactivation)", () => {
    expect(canTransition("suspended", "active")).toBe(true);
  });

  it("allows suspended → deregistered", () => {
    expect(canTransition("suspended", "deregistered")).toBe(true);
  });

  it("does not allow any transition from deregistered (terminal state)", () => {
    const statuses: DeviceStatus[] = ["pending_activation", "active", "suspended", "deregistered"];
    for (const target of statuses) {
      expect(canTransition("deregistered", target)).toBe(false);
    }
  });

  it("returns false for an unknown from status", () => {
    expect(canTransition("unknown" as DeviceStatus, "active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Token Generation
// ---------------------------------------------------------------------------

describe("generateDeviceToken", () => {
  it("generates a token prefixed with device_", () => {
    const { token } = generateDeviceToken();
    expect(token.startsWith("device_")).toBe(true);
  });

  it("generates a base64url-encoded body after prefix", () => {
    const { token } = generateDeviceToken();
    const body = token.slice("device_".length);
    // base64url uses A-Z, a-z, 0-9, -, _ (no +, /, =)
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a 48-byte random body (64 base64url chars)", () => {
    const { token } = generateDeviceToken();
    const body = token.slice("device_".length);
    // 48 bytes = 64 base64url characters
    expect(body.length).toBe(64);
  });

  it("generates a SHA-256 hex hash of the full token", () => {
    const { token, hash } = generateDeviceToken();
    const { createHash } = require("node:crypto");
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hash).toBe(expected);
  });

  it("produces unique tokens on successive calls", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});

// ---------------------------------------------------------------------------
// Auth Type Resolution
// ---------------------------------------------------------------------------

describe("getAuthType", () => {
  it("returns mtls for turnstile", () => {
    expect(getAuthType("turnstile")).toBe("mtls");
  });

  it("returns mtls for barrier", () => {
    expect(getAuthType("barrier")).toBe("mtls");
  });

  it("returns bearer_token for kiosk", () => {
    expect(getAuthType("kiosk")).toBe("bearer_token");
  });

  it("returns bearer_token for printer", () => {
    expect(getAuthType("printer")).toBe("bearer_token");
  });

  it("returns bearer_token for scanner", () => {
    expect(getAuthType("scanner")).toBe("bearer_token");
  });

  it("returns bearer_token for unknown types", () => {
    expect(getAuthType("unknown")).toBe("bearer_token");
  });
});

// ---------------------------------------------------------------------------
// Rate Limit Resolution
// ---------------------------------------------------------------------------

describe("getRateLimit", () => {
  it("returns 120 for turnstile", () => {
    expect(getRateLimit("turnstile")).toBe(120);
  });

  it("returns 120 for barrier", () => {
    expect(getRateLimit("barrier")).toBe(120);
  });

  it("returns 60 for kiosk", () => {
    expect(getRateLimit("kiosk")).toBe(60);
  });

  it("returns 60 for printer", () => {
    expect(getRateLimit("printer")).toBe(60);
  });

  it("returns 60 for scanner", () => {
    expect(getRateLimit("scanner")).toBe(60);
  });

  it("returns 60 for unknown types", () => {
    expect(getRateLimit("unknown")).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Firmware Version Comparison
// ---------------------------------------------------------------------------

describe("isFirmwareOutdated", () => {
  it("returns true when current is below minimum (major)", () => {
    expect(isFirmwareOutdated("1.0.0", "2.0.0")).toBe(true);
  });

  it("returns true when current is below minimum (minor)", () => {
    expect(isFirmwareOutdated("1.2.3", "1.3.0")).toBe(true);
  });

  it("returns true when current is below minimum (patch)", () => {
    expect(isFirmwareOutdated("1.2.3", "1.2.4")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isFirmwareOutdated("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false when current is above minimum", () => {
    expect(isFirmwareOutdated("2.0.0", "1.9.9")).toBe(false);
  });

  it("handles versions with different component counts", () => {
    expect(isFirmwareOutdated("1.2", "1.2.1")).toBe(true);
    expect(isFirmwareOutdated("1.2.1", "1.2")).toBe(false);
  });

  it("handles single-component versions", () => {
    expect(isFirmwareOutdated("1", "2")).toBe(true);
    expect(isFirmwareOutdated("2", "1")).toBe(false);
  });

  it("treats non-numeric parts as 0", () => {
    expect(isFirmwareOutdated("1.abc.0", "1.0.1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token Expiration
// ---------------------------------------------------------------------------

describe("isTokenExpired", () => {
  it("returns false when expiresAt is null (never expires)", () => {
    expect(isTokenExpired(null)).toBe(false);
  });

  it("returns true when expiresAt is in the past", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const now = new Date("2024-01-01T00:00:00Z");
    expect(isTokenExpired(past, now)).toBe(true);
  });

  it("returns false when expiresAt is in the future", () => {
    const future = new Date("2030-01-01T00:00:00Z");
    const now = new Date("2024-01-01T00:00:00Z");
    expect(isTokenExpired(future, now)).toBe(false);
  });

  it("returns true when expiresAt exactly equals now", () => {
    const same = new Date("2024-06-15T12:00:00Z");
    expect(isTokenExpired(same, same)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rotation Grace Period
// ---------------------------------------------------------------------------

describe("isInRotationGracePeriod", () => {
  it("returns false when rotatedAt is null (no rotation)", () => {
    expect(isInRotationGracePeriod(null)).toBe(false);
  });

  it("returns true within the default 24h grace window", () => {
    const rotatedAt = new Date("2024-06-15T00:00:00Z");
    const now = new Date("2024-06-15T12:00:00Z"); // 12 hours later
    expect(isInRotationGracePeriod(rotatedAt, BEARER_ROTATION_GRACE_MS, now)).toBe(true);
  });

  it("returns false after the default 24h grace window", () => {
    const rotatedAt = new Date("2024-06-15T00:00:00Z");
    const now = new Date("2024-06-16T01:00:00Z"); // 25 hours later
    expect(isInRotationGracePeriod(rotatedAt, BEARER_ROTATION_GRACE_MS, now)).toBe(false);
  });

  it("supports custom grace period (7 days for mTLS)", () => {
    const rotatedAt = new Date("2024-06-15T00:00:00Z");
    const withinGrace = new Date("2024-06-20T00:00:00Z"); // 5 days later
    const afterGrace = new Date("2024-06-23T00:00:00Z"); // 8 days later
    expect(isInRotationGracePeriod(rotatedAt, MTLS_ROTATION_GRACE_MS, withinGrace)).toBe(true);
    expect(isInRotationGracePeriod(rotatedAt, MTLS_ROTATION_GRACE_MS, afterGrace)).toBe(false);
  });

  it("returns false exactly at the grace period boundary", () => {
    const rotatedAt = new Date("2024-06-15T00:00:00Z");
    const exactEnd = new Date(rotatedAt.getTime() + BEARER_ROTATION_GRACE_MS);
    expect(isInRotationGracePeriod(rotatedAt, BEARER_ROTATION_GRACE_MS, exactEnd)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat Constants
// ---------------------------------------------------------------------------

describe("Heartbeat constants", () => {
  it("heartbeat interval is 30 seconds", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it("heartbeat TTL is 90 seconds (3 missed heartbeats)", () => {
    expect(HEARTBEAT_TTL_SECONDS).toBe(90);
  });

  it("offline alert delay is 2 minutes", () => {
    expect(OFFLINE_ALERT_DELAY_MS).toBe(120_000);
  });

  it("TTL covers exactly 3 heartbeat intervals", () => {
    expect(HEARTBEAT_TTL_SECONDS * 1000).toBe(HEARTBEAT_INTERVAL_MS * 3);
  });
});
