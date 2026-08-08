/**
 * Citizen Service — Grievance Domain: Deep test suite.
 *
 * Tests status machine, priority inference, department routing,
 * SLA auto-escalation, and all boundary conditions.
 *
 * Source: modules/grievance/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  GRIEVANCE_STATUSES,
  PRIORITIES,
  GRIEVANCE_ESCALATION_SLA_DAYS,
  assertGrievanceTransition,
  inferPriority,
  inferDepartmentRef,
  shouldAutoEscalate,
} from "../src/modules/grievance/domain.js";

describe("GRIEVANCE_STATUSES — status contract", () => {
  it("declares exactly 6 statuses", () => {
    expect(GRIEVANCE_STATUSES).toHaveLength(6);
  });

  it("contains all expected statuses in order", () => {
    expect([...GRIEVANCE_STATUSES]).toEqual([
      "registered", "assigned", "in_progress", "resolved", "closed", "reopened",
    ]);
  });
});

describe("PRIORITIES — priority contract", () => {
  it("declares exactly 4 levels", () => {
    expect(PRIORITIES).toHaveLength(4);
  });

  it("ordered from low to urgent", () => {
    expect([...PRIORITIES]).toEqual(["low", "normal", "high", "urgent"]);
  });
});

describe("GRIEVANCE_ESCALATION_SLA_DAYS", () => {
  it("is 7 days (statutory escalation window)", () => {
    expect(GRIEVANCE_ESCALATION_SLA_DAYS).toBe(7);
  });
});

describe("assertGrievanceTransition — status state machine", () => {
  // Valid transitions
  it("registered → assigned", () => {
    expect(() => assertGrievanceTransition("registered", "assigned")).not.toThrow();
  });

  it("assigned → in_progress", () => {
    expect(() => assertGrievanceTransition("assigned", "in_progress")).not.toThrow();
  });

  it("assigned → resolved (direct resolution)", () => {
    expect(() => assertGrievanceTransition("assigned", "resolved")).not.toThrow();
  });

  it("in_progress → resolved", () => {
    expect(() => assertGrievanceTransition("in_progress", "resolved")).not.toThrow();
  });

  it("in_progress → closed", () => {
    expect(() => assertGrievanceTransition("in_progress", "closed")).not.toThrow();
  });

  it("resolved → closed (citizen satisfied)", () => {
    expect(() => assertGrievanceTransition("resolved", "closed")).not.toThrow();
  });

  it("resolved → reopened (citizen unsatisfied)", () => {
    expect(() => assertGrievanceTransition("resolved", "reopened")).not.toThrow();
  });

  it("closed → reopened", () => {
    expect(() => assertGrievanceTransition("closed", "reopened")).not.toThrow();
  });

  it("reopened → assigned (re-assignment)", () => {
    expect(() => assertGrievanceTransition("reopened", "assigned")).not.toThrow();
  });

  it("reopened → in_progress", () => {
    expect(() => assertGrievanceTransition("reopened", "in_progress")).not.toThrow();
  });

  // Invalid transitions
  it("registered → resolved is illegal (must assign first)", () => {
    expect(() => assertGrievanceTransition("registered", "resolved")).toThrow("INVALID_TRANSITION");
  });

  it("registered → closed is illegal", () => {
    expect(() => assertGrievanceTransition("registered", "closed")).toThrow("INVALID_TRANSITION");
  });

  it("assigned → closed is illegal (must resolve or go through in_progress)", () => {
    expect(() => assertGrievanceTransition("assigned", "closed")).toThrow("INVALID_TRANSITION");
  });

  it("resolved → in_progress is illegal (must reopen first)", () => {
    expect(() => assertGrievanceTransition("resolved", "in_progress")).toThrow("INVALID_TRANSITION");
  });

  it("closed → assigned is illegal (must reopen first)", () => {
    expect(() => assertGrievanceTransition("closed", "assigned")).toThrow("INVALID_TRANSITION");
  });

  it("in_progress → registered is illegal (no backward to initial)", () => {
    expect(() => assertGrievanceTransition("in_progress", "registered")).toThrow("INVALID_TRANSITION");
  });

  it("same-to-same is illegal for all statuses", () => {
    for (const s of GRIEVANCE_STATUSES) {
      expect(() => assertGrievanceTransition(s, s)).toThrow("INVALID_TRANSITION");
    }
  });
});

describe("inferPriority — category-based priority assignment", () => {
  it("returns urgent for corruption", () => {
    expect(inferPriority("corruption")).toBe("urgent");
  });

  it("returns urgent for safety-related", () => {
    expect(inferPriority("Public Safety Hazard")).toBe("urgent");
  });

  it("returns urgent for emergency", () => {
    expect(inferPriority("Medical Emergency at Station")).toBe("urgent");
  });

  it("returns high for water issues", () => {
    expect(inferPriority("Water Supply Disruption")).toBe("high");
  });

  it("returns high for electricity", () => {
    expect(inferPriority("Electricity Outage")).toBe("high");
  });

  it("returns high for health", () => {
    expect(inferPriority("Health Center Closure")).toBe("high");
  });

  it("returns normal for general categories", () => {
    expect(inferPriority("General Complaint")).toBe("normal");
    expect(inferPriority("Education")).toBe("normal");
    expect(inferPriority("Revenue")).toBe("normal");
  });

  it("is case-insensitive", () => {
    expect(inferPriority("WATER")).toBe("high");
    expect(inferPriority("CORRUPTION")).toBe("urgent");
  });

  it("matches substring (not exact)", () => {
    expect(inferPriority("No water supply in ward 5")).toBe("high");
  });
});

describe("inferDepartmentRef — category-to-department routing", () => {
  it("routes water to dept:water", () => {
    expect(inferDepartmentRef("Water Supply Issue")).toBe("dept:water");
  });

  it("routes electricity to dept:power", () => {
    expect(inferDepartmentRef("Electricity Failure")).toBe("dept:power");
  });

  it("routes health to dept:health", () => {
    expect(inferDepartmentRef("Health Service Complaint")).toBe("dept:health");
  });

  it("routes roads/transport to dept:transport", () => {
    expect(inferDepartmentRef("Road Damage")).toBe("dept:transport");
    expect(inferDepartmentRef("Public Transport Delay")).toBe("dept:transport");
  });

  it("routes unknown categories to dept:general", () => {
    expect(inferDepartmentRef("General Query")).toBe("dept:general");
    expect(inferDepartmentRef("Education")).toBe("dept:general");
    expect(inferDepartmentRef("Revenue")).toBe("dept:general");
  });

  it("is case-insensitive", () => {
    expect(inferDepartmentRef("WATER")).toBe("dept:water");
  });
});

describe("shouldAutoEscalate — SLA breach detection", () => {
  it("returns false for non-assigned status", () => {
    const old = new Date("2020-01-01");
    expect(shouldAutoEscalate("registered", old, 7)).toBe(false);
    expect(shouldAutoEscalate("in_progress", old, 7)).toBe(false);
    expect(shouldAutoEscalate("resolved", old, 7)).toBe(false);
    expect(shouldAutoEscalate("closed", old, 7)).toBe(false);
  });

  it("returns true when assigned and SLA exceeded", () => {
    const updatedAt = new Date("2026-07-01");
    const now = new Date("2026-07-09"); // 8 days later > 7 SLA
    expect(shouldAutoEscalate("assigned", updatedAt, 7, now)).toBe(true);
  });

  it("returns false when within SLA window", () => {
    const updatedAt = new Date("2026-07-01");
    const now = new Date("2026-07-05"); // 4 days later < 7 SLA
    expect(shouldAutoEscalate("assigned", updatedAt, 7, now)).toBe(false);
  });

  it("returns false exactly at the SLA boundary (not exceeded)", () => {
    const updatedAt = new Date("2026-07-01T00:00:00Z");
    const now = new Date("2026-07-08T00:00:00Z"); // exactly 7 days
    expect(shouldAutoEscalate("assigned", updatedAt, 7, now)).toBe(false);
  });

  it("returns true one millisecond past SLA", () => {
    const updatedAt = new Date("2026-07-01T00:00:00.000Z");
    const now = new Date("2026-07-08T00:00:00.001Z");
    expect(shouldAutoEscalate("assigned", updatedAt, 7, now)).toBe(true);
  });

  it("uses default now when not specified", () => {
    const longAgo = new Date("2020-01-01");
    expect(shouldAutoEscalate("assigned", longAgo, 7)).toBe(true);
  });

  it("respects custom SLA days", () => {
    const updatedAt = new Date("2026-07-01");
    const now = new Date("2026-07-20"); // 19 days
    expect(shouldAutoEscalate("assigned", updatedAt, 30, now)).toBe(false); // 30 day SLA
    expect(shouldAutoEscalate("assigned", updatedAt, 15, now)).toBe(true); // 15 day SLA
  });
});
