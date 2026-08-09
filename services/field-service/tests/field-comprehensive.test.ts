/**
 * Field Service — Comprehensive Domain Tests.
 *
 * Tests task lifecycle, priority scoring, SLA breach detection, assignment,
 * geo-fencing (Haversine), visit validation, duration, outcome classification.
 *
 * Source: modules/tasks/domain.ts, modules/visits/domain.ts
 */
import { describe, it, expect } from "vitest";
import { isValidTransition, validateTransition, calculatePriorityScore, detectSlaBreach, validateAssignment, type TaskStatus } from "../src/modules/tasks/domain.js";
import { haversineDistance, validateGeoFence, validateCheckIn, validateCheckOut, calculateDurationMinutes, classifyVisitOutcome } from "../src/modules/visits/domain.js";

// ═══ TASK LIFECYCLE ═══

describe("isValidTransition — task state machine", () => {
  const valid: [TaskStatus, TaskStatus][] = [
    ["unassigned", "assigned"], ["unassigned", "cancelled"],
    ["assigned", "in_progress"], ["assigned", "cancelled"], ["assigned", "unassigned"],
    ["in_progress", "completed"], ["in_progress", "cancelled"],
  ];
  for (const [f, t] of valid) it(`${f} → ${t}`, () => expect(isValidTransition(f, t)).toBe(true));

  it("completed is terminal", () => {
    for (const t of ["unassigned", "assigned", "in_progress", "cancelled"] as TaskStatus[]) {
      expect(isValidTransition("completed", t)).toBe(false);
    }
  });
  it("cancelled is terminal", () => {
    for (const t of ["unassigned", "assigned", "in_progress", "completed"] as TaskStatus[]) {
      expect(isValidTransition("cancelled", t)).toBe(false);
    }
  });
  it("unassigned → completed is illegal (must go through in_progress)", () => expect(isValidTransition("unassigned", "completed")).toBe(false));
  it("unassigned → in_progress is illegal (must assign first)", () => expect(isValidTransition("unassigned", "in_progress")).toBe(false));
});

describe("validateTransition", () => {
  it("null for valid", () => expect(validateTransition("assigned", "in_progress")).toBeNull());
  it("error string for invalid", () => expect(validateTransition("completed", "assigned")).toContain("invalid transition"));
});

// ═══ PRIORITY SCORING ═══

describe("calculatePriorityScore", () => {
  it("priority 1 = highest base (50+)", () => {
    const score = calculatePriorityScore({ priority: 1, dueDate: null });
    expect(score).toBeGreaterThanOrEqual(47); // 60 - 0 = 60 base
  });
  it("priority 5 = lowest base (10)", () => {
    const score = calculatePriorityScore({ priority: 5, dueDate: null });
    expect(score).toBe(10); // 60 - 4*12.5 = 10
  });
  it("overdue task gets urgency bonus", () => {
    const overdue = calculatePriorityScore({ priority: 3, dueDate: "2020-01-01T00:00:00Z" });
    const notDue = calculatePriorityScore({ priority: 3, dueDate: null });
    expect(overdue).toBeGreaterThan(notDue);
  });
  it("high density area gets +5 bonus", () => {
    const withDensity = calculatePriorityScore({ priority: 3, dueDate: null, highDensityArea: true });
    const without = calculatePriorityScore({ priority: 3, dueDate: null, highDensityArea: false });
    expect(withDensity - without).toBe(5);
  });
  it("score capped at 100", () => {
    const score = calculatePriorityScore({ priority: 1, dueDate: "2020-01-01T00:00:00Z", highDensityArea: true });
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ═══ SLA BREACH ═══

describe("detectSlaBreach", () => {
  it("null when no dueDate", () => expect(detectSlaBreach({ dueDate: "", status: "assigned" })).toBeNull());
  it("null for cancelled tasks", () => expect(detectSlaBreach({ dueDate: "2020-01-01T00:00:00Z", status: "cancelled" })).toBeNull());
  it("breached when overdue active task", () => {
    const r = detectSlaBreach({ dueDate: "2020-01-01T00:00:00Z", status: "in_progress" });
    expect(r?.breached).toBe(true);
    expect(r?.overdueMinutes).toBeGreaterThan(0);
  });
  it("not breached when due in future", () => {
    const r = detectSlaBreach({ dueDate: "2099-01-01T00:00:00Z", status: "assigned" });
    expect(r?.breached).toBe(false);
  });
  it("breached when completed after due", () => {
    const r = detectSlaBreach({ dueDate: "2026-07-01T10:00:00Z", status: "completed", completedAt: "2026-07-01T12:00:00Z" });
    expect(r?.breached).toBe(true);
    expect(r?.overdueMinutes).toBe(120);
  });
  it("not breached when completed before due", () => {
    const r = detectSlaBreach({ dueDate: "2026-07-01T12:00:00Z", status: "completed", completedAt: "2026-07-01T10:00:00Z" });
    expect(r?.breached).toBe(false);
  });
});

// ═══ ASSIGNMENT ═══

describe("validateAssignment", () => {
  it("null when valid (new assignee, active task)", () => expect(validateAssignment("unassigned", null, "agent-1")).toBeNull());
  it("error for completed task", () => expect(validateAssignment("completed", "agent-1", "agent-2")).toContain("cannot assign"));
  it("error for cancelled task", () => expect(validateAssignment("cancelled", null, "agent-1")).toContain("cannot assign"));
  it("error for same assignee", () => expect(validateAssignment("assigned", "agent-1", "agent-1")).toContain("already assigned"));
});

// ═══ GEO-FENCING ═══

describe("haversineDistance", () => {
  it("same point = 0 distance", () => expect(haversineDistance({ latitude: 28.6, longitude: 77.2 }, { latitude: 28.6, longitude: 77.2 })).toBeCloseTo(0, 0));
  it("Delhi to Noida ≈ 20-30 km", () => {
    const d = haversineDistance({ latitude: 28.6139, longitude: 77.2090 }, { latitude: 28.5355, longitude: 77.3910 });
    expect(d).toBeGreaterThan(15000); // > 15km
    expect(d).toBeLessThan(30000); // < 30km
  });
  it("poles to equator ≈ 10,000 km", () => {
    const d = haversineDistance({ latitude: 90, longitude: 0 }, { latitude: 0, longitude: 0 });
    expect(d).toBeGreaterThan(9_900_000);
    expect(d).toBeLessThan(10_100_000);
  });
});

describe("validateGeoFence", () => {
  const target = { latitude: 28.6, longitude: 77.2 };
  it("null when within radius", () => expect(validateGeoFence({ latitude: 28.6001, longitude: 77.2001 }, target)).toBeNull());
  it("error when outside radius", () => {
    const far = { latitude: 28.7, longitude: 77.3 }; // ~14km away
    expect(validateGeoFence(far, target, 200)).toContain("from target");
  });
  it("custom radius", () => expect(validateGeoFence({ latitude: 28.6001, longitude: 77.2001 }, target, 50000)).toBeNull());
});

// ═══ VISIT VALIDATION ═══

describe("validateCheckIn", () => {
  it("null for valid location", () => expect(validateCheckIn({ latitude: 28.6, longitude: 77.2 })).toBeNull());
  it("error for missing latitude", () => expect(validateCheckIn({ longitude: 77.2 })).toContain("numeric latitude"));
  it("error for latitude > 90", () => expect(validateCheckIn({ latitude: 91, longitude: 0 })).toContain("between -90"));
  it("error for longitude > 180", () => expect(validateCheckIn({ latitude: 0, longitude: 181 })).toContain("between -180"));
});

describe("validateCheckOut", () => {
  it("null for valid checkout", () => expect(validateCheckOut("2026-07-01T10:00:00Z", "2026-07-01T11:00:00Z")).toBeNull());
  it("error when no check-in", () => expect(validateCheckOut(null, "2026-07-01T11:00:00Z")).toContain("no check-in"));
  it("error when checkout before checkin", () => expect(validateCheckOut("2026-07-01T11:00:00Z", "2026-07-01T10:00:00Z")).toContain("after check-in"));
});

describe("calculateDurationMinutes", () => {
  it("60 minutes for 1 hour", () => expect(calculateDurationMinutes("2026-07-01T10:00:00Z", "2026-07-01T11:00:00Z")).toBe(60));
  it("0 for same time", () => expect(calculateDurationMinutes("2026-07-01T10:00:00Z", "2026-07-01T10:00:00Z")).toBe(0));
});

describe("classifyVisitOutcome", () => {
  it("< 5 min = short_visit", () => expect(classifyVisitOutcome(3)).toBe("short_visit"));
  it("5 min = completed", () => expect(classifyVisitOutcome(5)).toBe("completed"));
  it("60 min = completed", () => expect(classifyVisitOutcome(60)).toBe("completed"));
  it("120 min = completed", () => expect(classifyVisitOutcome(120)).toBe("completed"));
  it("> 120 min = extended_visit", () => expect(classifyVisitOutcome(121)).toBe("extended_visit"));
});
