/**
 * HRMS Pack #33 — Device Trust: Validator boundary tests.
 *
 * Tests device report schema, policy update schema, and platform enum.
 * Source: modules/device-trust/routes.ts (inline zod schemas)
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate schemas from routes.ts for unit testing
const deviceReportSchema = z.object({
  deviceId: z.string().min(5),
  deviceName: z.string().max(100),
  platform: z.enum(["android", "ios", "web"]),
  osVersion: z.string().max(30),
  appVersion: z.string().max(20),
  isRooted: z.boolean().optional(),
  hasScreenLock: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
  biometricAvailable: z.boolean().optional(),
});

const policyUpdateSchema = z.object({
  minOsVersionAndroid: z.string().max(10).optional(),
  minOsVersionIos: z.string().max(10).optional(),
  minAppVersion: z.string().max(20).optional(),
  blockRooted: z.boolean().optional(),
  requireScreenLock: z.boolean().optional(),
  requireBiometric: z.boolean().optional(),
  maxInactiveDays: z.number().int().min(7).max(365).optional(),
});

describe("deviceReportSchema — heartbeat validation", () => {
  const valid = {
    deviceId: "device-abc-12345",
    deviceName: "Pixel 7 Pro",
    platform: "android" as const,
    osVersion: "14",
    appVersion: "2.1.0",
  };

  it("accepts valid heartbeat report", () => {
    expect(deviceReportSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts report with optional compliance fields", () => {
    expect(deviceReportSchema.safeParse({
      ...valid, isRooted: false, hasScreenLock: true,
      isEncrypted: true, biometricAvailable: true,
    }).success).toBe(true);
  });

  it("rejects deviceId shorter than 5 chars", () => {
    expect(deviceReportSchema.safeParse({ ...valid, deviceId: "abc" }).success).toBe(false);
  });

  it("rejects deviceName exceeding 100 chars", () => {
    expect(deviceReportSchema.safeParse({ ...valid, deviceName: "x".repeat(101) }).success).toBe(false);
  });

  it("rejects invalid platform", () => {
    expect(deviceReportSchema.safeParse({ ...valid, platform: "windows" }).success).toBe(false);
  });

  it("accepts all valid platforms", () => {
    for (const p of ["android", "ios", "web"]) {
      expect(deviceReportSchema.safeParse({ ...valid, platform: p }).success).toBe(true);
    }
  });

  it("rejects osVersion exceeding 30 chars", () => {
    expect(deviceReportSchema.safeParse({ ...valid, osVersion: "x".repeat(31) }).success).toBe(false);
  });

  it("rejects appVersion exceeding 20 chars", () => {
    expect(deviceReportSchema.safeParse({ ...valid, appVersion: "x".repeat(21) }).success).toBe(false);
  });
});

describe("policyUpdateSchema — compliance policy", () => {
  it("accepts empty object (all optional)", () => {
    expect(policyUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid policy update", () => {
    expect(policyUpdateSchema.safeParse({
      blockRooted: true,
      requireScreenLock: true,
      maxInactiveDays: 30,
      minOsVersionAndroid: "13",
    }).success).toBe(true);
  });

  it("rejects maxInactiveDays below 7", () => {
    expect(policyUpdateSchema.safeParse({ maxInactiveDays: 6 }).success).toBe(false);
  });

  it("rejects maxInactiveDays above 365", () => {
    expect(policyUpdateSchema.safeParse({ maxInactiveDays: 366 }).success).toBe(false);
  });

  it("rejects non-integer maxInactiveDays", () => {
    expect(policyUpdateSchema.safeParse({ maxInactiveDays: 30.5 }).success).toBe(false);
  });

  it("accepts boundary values (7 and 365)", () => {
    expect(policyUpdateSchema.safeParse({ maxInactiveDays: 7 }).success).toBe(true);
    expect(policyUpdateSchema.safeParse({ maxInactiveDays: 365 }).success).toBe(true);
  });

  it("rejects minOsVersionAndroid exceeding 10 chars", () => {
    expect(policyUpdateSchema.safeParse({ minOsVersionAndroid: "x".repeat(11) }).success).toBe(false);
  });
});
