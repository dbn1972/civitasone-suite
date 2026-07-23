/**
 * Unit tests for Telemetry / IoT domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: SVC-110
 */
import { describe, it, expect } from "vitest";
import {
  DEVICE_STATES,
  ALERT_STATES,
  ALERT_TRANSITIONS,
  evaluateAlertRule,
  matchAlertRules,
  assertDeviceActive,
  assertValidAlertTransition,
  DomainError,
  type AlertRule,
  type Reading,
} from "../src/modules/telemetry/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("DEVICE_STATES", () => {
  it("contains exactly 3 states", () => {
    expect(DEVICE_STATES).toHaveLength(3);
  });

  it("includes active, inactive, maintenance", () => {
    expect(DEVICE_STATES).toContain("active");
    expect(DEVICE_STATES).toContain("inactive");
    expect(DEVICE_STATES).toContain("maintenance");
  });
});

describe("ALERT_STATES", () => {
  it("contains exactly 4 states", () => {
    expect(ALERT_STATES).toHaveLength(4);
  });

  it("includes open, acknowledged, resolved, finding_created", () => {
    expect(ALERT_STATES).toContain("open");
    expect(ALERT_STATES).toContain("acknowledged");
    expect(ALERT_STATES).toContain("resolved");
    expect(ALERT_STATES).toContain("finding_created");
  });
});

describe("ALERT_TRANSITIONS", () => {
  it("open can go to acknowledged", () => {
    expect(ALERT_TRANSITIONS.open).toContain("acknowledged");
  });

  it("acknowledged can go to resolved or finding_created", () => {
    expect(ALERT_TRANSITIONS.acknowledged).toContain("resolved");
    expect(ALERT_TRANSITIONS.acknowledged).toContain("finding_created");
  });

  it("resolved is terminal", () => {
    expect(ALERT_TRANSITIONS.resolved).toHaveLength(0);
  });

  it("finding_created is terminal", () => {
    expect(ALERT_TRANSITIONS.finding_created).toHaveLength(0);
  });
});

// ── evaluateAlertRule ─────────────────────────────────────────────────────────

describe("evaluateAlertRule", () => {
  const baseReading: Reading = {
    value: 75,
    readingType: "temperature",
    deviceType: "sensor",
  };

  const baseRule: AlertRule = {
    id: "rule-1",
    deviceType: "sensor",
    readingType: "temperature",
    operator: "gt",
    thresholdValue: 50,
    severity: "critical",
    isActive: true,
  };

  it("returns true when value > threshold (gt operator)", () => {
    expect(evaluateAlertRule(baseReading, baseRule)).toBe(true);
  });

  it("returns false when value <= threshold (gt operator)", () => {
    const reading = { ...baseReading, value: 50 };
    expect(evaluateAlertRule(reading, baseRule)).toBe(false);
  });

  it("returns true when value < threshold (lt operator)", () => {
    const rule = { ...baseRule, operator: "lt" as const, thresholdValue: 100 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(true);
  });

  it("returns false when value >= threshold (lt operator)", () => {
    const rule = { ...baseRule, operator: "lt" as const, thresholdValue: 75 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("returns true when value >= threshold (gte operator)", () => {
    const rule = { ...baseRule, operator: "gte" as const, thresholdValue: 75 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(true);
  });

  it("returns false when value < threshold (gte operator)", () => {
    const rule = { ...baseRule, operator: "gte" as const, thresholdValue: 76 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("returns true when value <= threshold (lte operator)", () => {
    const rule = { ...baseRule, operator: "lte" as const, thresholdValue: 75 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(true);
  });

  it("returns false when value > threshold (lte operator)", () => {
    const rule = { ...baseRule, operator: "lte" as const, thresholdValue: 74 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("returns true when value === threshold (eq operator)", () => {
    const rule = { ...baseRule, operator: "eq" as const, thresholdValue: 75 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(true);
  });

  it("returns false when value !== threshold (eq operator)", () => {
    const rule = { ...baseRule, operator: "eq" as const, thresholdValue: 76 };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("returns false if rule is inactive", () => {
    const rule = { ...baseRule, isActive: false };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("returns false if deviceType does not match", () => {
    const rule = { ...baseRule, deviceType: "drone" };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("returns false if readingType does not match", () => {
    const rule = { ...baseRule, readingType: "humidity" };
    expect(evaluateAlertRule(baseReading, rule)).toBe(false);
  });

  it("handles zero threshold correctly", () => {
    const reading = { ...baseReading, value: 0 };
    const rule = { ...baseRule, operator: "eq" as const, thresholdValue: 0 };
    expect(evaluateAlertRule(reading, rule)).toBe(true);
  });

  it("handles negative values correctly", () => {
    const reading = { ...baseReading, value: -10 };
    const rule = { ...baseRule, operator: "lt" as const, thresholdValue: 0 };
    expect(evaluateAlertRule(reading, rule)).toBe(true);
  });
});

// ── matchAlertRules ───────────────────────────────────────────────────────────

describe("matchAlertRules", () => {
  const reading: Reading = {
    value: 100,
    readingType: "temperature",
    deviceType: "sensor",
  };

  const rules: AlertRule[] = [
    {
      id: "r1", deviceType: "sensor", readingType: "temperature",
      operator: "gt", thresholdValue: 50, severity: "critical", isActive: true,
    },
    {
      id: "r2", deviceType: "sensor", readingType: "temperature",
      operator: "gt", thresholdValue: 200, severity: "major", isActive: true,
    },
    {
      id: "r3", deviceType: "drone", readingType: "temperature",
      operator: "gt", thresholdValue: 50, severity: "minor", isActive: true,
    },
    {
      id: "r4", deviceType: "sensor", readingType: "humidity",
      operator: "gt", thresholdValue: 50, severity: "minor", isActive: true,
    },
    {
      id: "r5", deviceType: "sensor", readingType: "temperature",
      operator: "gt", thresholdValue: 80, severity: "minor", isActive: false,
    },
  ];

  it("returns only rules whose conditions are met", () => {
    const matches = matchAlertRules(reading, rules);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe("r1");
  });

  it("returns empty array if no rules match", () => {
    const coldReading: Reading = { value: 10, readingType: "temperature", deviceType: "sensor" };
    const matches = matchAlertRules(coldReading, rules);
    expect(matches).toHaveLength(0);
  });

  it("returns empty array if rules list is empty", () => {
    expect(matchAlertRules(reading, [])).toHaveLength(0);
  });

  it("excludes inactive rules", () => {
    // r5 would match but is inactive
    const matches = matchAlertRules(reading, rules);
    const matchIds = matches.map((m) => m.id);
    expect(matchIds).not.toContain("r5");
  });

  it("can return multiple matching rules", () => {
    const highReading: Reading = { value: 250, readingType: "temperature", deviceType: "sensor" };
    const matches = matchAlertRules(highReading, rules);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const matchIds = matches.map((m) => m.id);
    expect(matchIds).toContain("r1");
    expect(matchIds).toContain("r2");
  });
});

// ── assertDeviceActive ────────────────────────────────────────────────────────

describe("assertDeviceActive", () => {
  it("does not throw for active status", () => {
    expect(() => assertDeviceActive("active")).not.toThrow();
  });

  it("throws DEVICE_NOT_ACTIVE for inactive status", () => {
    try {
      assertDeviceActive("inactive");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("DEVICE_NOT_ACTIVE");
    }
  });

  it("throws DEVICE_NOT_ACTIVE for maintenance status", () => {
    expect(() => assertDeviceActive("maintenance")).toThrow(DomainError);
  });

  it("error message includes current status", () => {
    try {
      assertDeviceActive("maintenance");
    } catch (e) {
      expect((e as DomainError).message).toContain("maintenance");
    }
  });
});

// ── assertValidAlertTransition ────────────────────────────────────────────────

describe("assertValidAlertTransition", () => {
  it("allows open → acknowledged", () => {
    expect(() => assertValidAlertTransition("open", "acknowledged")).not.toThrow();
  });

  it("allows acknowledged → resolved", () => {
    expect(() => assertValidAlertTransition("acknowledged", "resolved")).not.toThrow();
  });

  it("allows acknowledged → finding_created", () => {
    expect(() => assertValidAlertTransition("acknowledged", "finding_created")).not.toThrow();
  });

  it("throws for open → resolved (must acknowledge first)", () => {
    expect(() => assertValidAlertTransition("open", "resolved")).toThrow(DomainError);
  });

  it("throws for open → finding_created (must acknowledge first)", () => {
    expect(() => assertValidAlertTransition("open", "finding_created")).toThrow(DomainError);
  });

  it("throws for resolved → acknowledged (terminal)", () => {
    expect(() => assertValidAlertTransition("resolved", "acknowledged")).toThrow(DomainError);
  });

  it("throws for finding_created → resolved (terminal)", () => {
    expect(() => assertValidAlertTransition("finding_created", "resolved")).toThrow(DomainError);
  });

  it("error code is INVALID_TRANSITION", () => {
    try {
      assertValidAlertTransition("resolved", "open");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("error message includes current and target states", () => {
    try {
      assertValidAlertTransition("open", "resolved");
    } catch (e) {
      expect((e as DomainError).message).toContain("open");
      expect((e as DomainError).message).toContain("resolved");
    }
  });
});
