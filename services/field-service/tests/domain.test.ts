/**
 * Domain logic unit tests — tasks, visits, routes, sync.
 * All branches, edge cases, and error paths covered.
 */
import { describe, it, expect } from "vitest";

// ── TASKS DOMAIN ──────────────────────────────────────────────────────────────

import {
  isValidTransition,
  validateTransition,
  calculatePriorityScore,
  detectSlaBreach,
  validateAssignment,
} from "../src/modules/tasks/domain.js";

describe("tasks/domain — state machine", () => {
  it("allows valid transitions", () => {
    expect(isValidTransition("unassigned", "assigned")).toBe(true);
    expect(isValidTransition("unassigned", "cancelled")).toBe(true);
    expect(isValidTransition("assigned", "in_progress")).toBe(true);
    expect(isValidTransition("assigned", "cancelled")).toBe(true);
    expect(isValidTransition("assigned", "unassigned")).toBe(true);
    expect(isValidTransition("in_progress", "completed")).toBe(true);
    expect(isValidTransition("in_progress", "cancelled")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("unassigned", "completed")).toBe(false);
    expect(isValidTransition("unassigned", "in_progress")).toBe(false);
    expect(isValidTransition("completed", "assigned")).toBe(false);
    expect(isValidTransition("completed", "in_progress")).toBe(false);
    expect(isValidTransition("cancelled", "assigned")).toBe(false);
    expect(isValidTransition("cancelled", "in_progress")).toBe(false);
  });

  it("validateTransition returns error string for invalid transition", () => {
    expect(validateTransition("completed", "assigned")).toBe("invalid transition: completed → assigned");
  });

  it("validateTransition returns null for valid transition", () => {
    expect(validateTransition("assigned", "in_progress")).toBeNull();
  });
});

describe("tasks/domain — priority scoring", () => {
  it("highest priority (1) gets higher base score", () => {
    const s1 = calculatePriorityScore({ priority: 1, dueDate: null });
    const s5 = calculatePriorityScore({ priority: 5, dueDate: null });
    expect(s1).toBeGreaterThan(s5);
  });

  it("adds urgency bonus for overdue tasks", () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 86400_000 * 7).toISOString();
    const overdue = calculatePriorityScore({ priority: 3, dueDate: past });
    const notDue = calculatePriorityScore({ priority: 3, dueDate: future });
    expect(overdue).toBeGreaterThan(notDue);
  });

  it("caps score at 100", () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const score = calculatePriorityScore({ priority: 1, dueDate: past, highDensityArea: true });
    expect(score).toBeLessThanOrEqual(100);
  });

  it("adds density bonus", () => {
    const withDensity = calculatePriorityScore({ priority: 3, dueDate: null, highDensityArea: true });
    const without = calculatePriorityScore({ priority: 3, dueDate: null, highDensityArea: false });
    expect(withDensity).toBe(without + 5);
  });
});

describe("tasks/domain — SLA breach detection", () => {
  it("detects overdue active task", () => {
    const past = new Date(Date.now() - 60_000 * 30).toISOString(); // 30 min ago
    const result = detectSlaBreach({ dueDate: past, status: "in_progress" });
    expect(result).not.toBeNull();
    expect(result!.breached).toBe(true);
    expect(result!.overdueMinutes).toBeGreaterThan(0);
  });

  it("no breach for future due date", () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    const result = detectSlaBreach({ dueDate: future, status: "assigned" });
    expect(result).not.toBeNull();
    expect(result!.breached).toBe(false);
  });

  it("returns null for cancelled tasks", () => {
    const past = new Date(Date.now() - 60_000 * 30).toISOString();
    const result = detectSlaBreach({ dueDate: past, status: "cancelled" });
    expect(result).toBeNull();
  });

  it("checks completedAt for completed tasks", () => {
    const due = "2025-01-01T10:00:00Z";
    const completedLate = "2025-01-01T12:00:00Z";
    const result = detectSlaBreach({ dueDate: due, status: "completed", completedAt: completedLate });
    expect(result).not.toBeNull();
    expect(result!.breached).toBe(true);
    expect(result!.overdueMinutes).toBe(120);
  });

  it("no breach for on-time completion", () => {
    const due = "2025-01-01T10:00:00Z";
    const completedOnTime = "2025-01-01T09:00:00Z";
    const result = detectSlaBreach({ dueDate: due, status: "completed", completedAt: completedOnTime });
    expect(result).not.toBeNull();
    expect(result!.breached).toBe(false);
  });
});

describe("tasks/domain — assignment validation", () => {
  it("rejects assignment to completed task", () => {
    const err = validateAssignment("completed", null, "user-1");
    expect(err).toBe("cannot assign: task is completed");
  });

  it("rejects assignment to cancelled task", () => {
    const err = validateAssignment("cancelled", null, "user-1");
    expect(err).toBe("cannot assign: task is cancelled");
  });

  it("rejects re-assignment to same agent", () => {
    const err = validateAssignment("assigned", "user-1", "user-1");
    expect(err).toBe("cannot assign: already assigned to this agent");
  });

  it("allows valid assignment", () => {
    expect(validateAssignment("unassigned", null, "user-1")).toBeNull();
    expect(validateAssignment("assigned", "user-1", "user-2")).toBeNull();
  });
});

// ── VISITS DOMAIN ─────────────────────────────────────────────────────────────

import {
  haversineDistance,
  validateGeoFence,
  validateCheckIn,
  validateCheckOut,
  calculateDurationMinutes,
  classifyVisitOutcome,
} from "../src/modules/visits/domain.js";

describe("visits/domain — haversine distance", () => {
  it("calculates zero distance for same point", () => {
    const p = { latitude: 28.6139, longitude: 77.209 };
    expect(haversineDistance(p, p)).toBe(0);
  });

  it("calculates reasonable distance between Delhi and Mumbai", () => {
    const delhi = { latitude: 28.6139, longitude: 77.209 };
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    const dist = haversineDistance(delhi, mumbai);
    // ~1,150–1,200 km = 1,150,000–1,200,000 m
    expect(dist).toBeGreaterThan(1_100_000);
    expect(dist).toBeLessThan(1_250_000);
  });
});

describe("visits/domain — geo-fence validation", () => {
  it("allows point within radius", () => {
    const target = { latitude: 28.6139, longitude: 77.209 };
    // Slightly offset (should be within 200m)
    const checkIn = { latitude: 28.6140, longitude: 77.2091 };
    expect(validateGeoFence(checkIn, target)).toBeNull();
  });

  it("rejects point outside radius", () => {
    const target = { latitude: 28.6139, longitude: 77.209 };
    // Far away
    const checkIn = { latitude: 28.62, longitude: 77.22 };
    const error = validateGeoFence(checkIn, target);
    expect(error).toContain("from target");
  });
});

describe("visits/domain — validateCheckIn", () => {
  it("rejects missing lat/lng", () => {
    expect(validateCheckIn({})).toBe("location must include numeric latitude and longitude");
    expect(validateCheckIn({ latitude: 28 })).toBe("location must include numeric latitude and longitude");
  });

  it("rejects invalid latitude range", () => {
    expect(validateCheckIn({ latitude: 91, longitude: 77 })).toBe("latitude must be between -90 and 90");
  });

  it("rejects invalid longitude range", () => {
    expect(validateCheckIn({ latitude: 28, longitude: 181 })).toBe("longitude must be between -180 and 180");
  });

  it("accepts valid location", () => {
    expect(validateCheckIn({ latitude: 28.6139, longitude: 77.209 })).toBeNull();
  });
});

describe("visits/domain — validateCheckOut", () => {
  it("rejects checkout without checkin", () => {
    expect(validateCheckOut(null, "2025-01-01T12:00:00Z")).toBe("cannot check out: no check-in recorded");
  });

  it("rejects checkout before checkin", () => {
    expect(validateCheckOut("2025-01-01T12:00:00Z", "2025-01-01T11:00:00Z"))
      .toBe("check-out time must be after check-in time");
  });

  it("accepts valid checkout", () => {
    expect(validateCheckOut("2025-01-01T10:00:00Z", "2025-01-01T12:00:00Z")).toBeNull();
  });
});

describe("visits/domain — duration & classification", () => {
  it("calculates duration in minutes", () => {
    expect(calculateDurationMinutes("2025-01-01T10:00:00Z", "2025-01-01T10:30:00Z")).toBe(30);
    expect(calculateDurationMinutes("2025-01-01T10:00:00Z", "2025-01-01T12:00:00Z")).toBe(120);
  });

  it("classifies short visits", () => {
    expect(classifyVisitOutcome(3)).toBe("short_visit");
    expect(classifyVisitOutcome(4)).toBe("short_visit");
  });

  it("classifies completed visits", () => {
    expect(classifyVisitOutcome(5)).toBe("completed");
    expect(classifyVisitOutcome(60)).toBe("completed");
    expect(classifyVisitOutcome(120)).toBe("completed");
  });

  it("classifies extended visits", () => {
    expect(classifyVisitOutcome(121)).toBe("extended_visit");
    expect(classifyVisitOutcome(300)).toBe("extended_visit");
  });
});

// ── ROUTES DOMAIN ─────────────────────────────────────────────────────────────

import {
  optimizeRouteOrder,
  calculateRouteDistance,
  scoreRoute,
  validateRouteTransition,
} from "../src/modules/routes/domain.js";

describe("routes/domain — route optimization", () => {
  it("returns identity for single waypoint", () => {
    const waypoints = [{ taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 1 }];
    expect(optimizeRouteOrder(waypoints)).toEqual([0]);
  });

  it("returns [0,1] for two waypoints", () => {
    const waypoints = [
      { taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 1 },
      { taskId: "t2", latitude: 28.7, longitude: 77.3, priority: 2 },
    ];
    expect(optimizeRouteOrder(waypoints)).toEqual([0, 1]);
  });

  it("prioritizes high-priority tasks first", () => {
    const waypoints = [
      { taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 5 },
      { taskId: "t2", latitude: 28.61, longitude: 77.21, priority: 1 },
      { taskId: "t3", latitude: 28.62, longitude: 77.22, priority: 3 },
    ];
    const order = optimizeRouteOrder(waypoints);
    // Highest priority (1) should be first
    expect(order[0]).toBe(1);
  });

  it("returns all indices exactly once", () => {
    const waypoints = [
      { taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 2 },
      { taskId: "t2", latitude: 28.7, longitude: 77.3, priority: 1 },
      { taskId: "t3", latitude: 28.8, longitude: 77.4, priority: 3 },
      { taskId: "t4", latitude: 28.9, longitude: 77.5, priority: 4 },
    ];
    const order = optimizeRouteOrder(waypoints);
    expect(order.sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("routes/domain — distance calculation", () => {
  it("returns 0 for single waypoint", () => {
    const waypoints = [{ taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 1 }];
    expect(calculateRouteDistance(waypoints, [0])).toBe(0);
  });

  it("calculates non-zero distance for multiple waypoints", () => {
    const waypoints = [
      { taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 1 },
      { taskId: "t2", latitude: 28.7, longitude: 77.3, priority: 2 },
    ];
    const dist = calculateRouteDistance(waypoints, [0, 1]);
    expect(dist).toBeGreaterThan(0);
  });
});

describe("routes/domain — route scoring", () => {
  it("returns valid score object", () => {
    const waypoints = [
      { taskId: "t1", latitude: 28.6, longitude: 77.2, priority: 1 },
      { taskId: "t2", latitude: 28.7, longitude: 77.3, priority: 3 },
    ];
    const score = scoreRoute(waypoints, [0, 1]);
    expect(score.totalDistanceKm).toBeGreaterThan(0);
    expect(score.estimatedDurationMinutes).toBeGreaterThan(0);
    expect(score.priorityCoverage).toBeGreaterThanOrEqual(0);
    expect(score.priorityCoverage).toBeLessThanOrEqual(1);
  });
});

describe("routes/domain — route transition validation", () => {
  it("allows valid transitions", () => {
    expect(validateRouteTransition("draft", "optimized")).toBeNull();
    expect(validateRouteTransition("optimized", "in_progress")).toBeNull();
    expect(validateRouteTransition("optimized", "draft")).toBeNull();
    expect(validateRouteTransition("in_progress", "completed")).toBeNull();
  });

  it("rejects invalid transitions", () => {
    expect(validateRouteTransition("draft", "completed")).toBe("invalid route transition: draft → completed");
    expect(validateRouteTransition("completed", "draft")).toBe("invalid route transition: completed → draft");
  });
});

// ── SYNC DOMAIN ───────────────────────────────────────────────────────────────

import {
  hasConflict,
  resolveConflict,
  validateSyncBatch,
  determineStrategy,
} from "../src/modules/sync/domain.js";

describe("sync/domain — conflict detection", () => {
  it("detects conflict when client version is behind", () => {
    expect(hasConflict(1, 3)).toBe(true);
  });

  it("no conflict when versions match", () => {
    expect(hasConflict(3, 3)).toBe(false);
  });

  it("no conflict when client is ahead (rare edge case)", () => {
    expect(hasConflict(4, 3)).toBe(false);
  });
});

describe("sync/domain — conflict resolution", () => {
  const serverEntity = { version: 3, updatedAt: "2025-01-01T12:00:00Z", data: { name: "Server", city: "Delhi" } };

  it("server-wins strategy keeps server data", () => {
    const result = resolveConflict("server_wins", { name: "Client" }, serverEntity, 1);
    expect(result.winner).toBe("server");
    expect(result.finalData).toEqual(serverEntity.data);
  });

  it("client-wins strategy keeps client data", () => {
    const result = resolveConflict("client_wins", { name: "Client" }, serverEntity, 1);
    expect(result.winner).toBe("client");
    expect(result.finalData).toEqual({ name: "Client" });
  });

  it("merge strategy combines fields", () => {
    const result = resolveConflict("merge", { name: "Client", city: "Delhi" }, serverEntity, 1);
    expect(result.winner).toBe("merged");
    expect(result.finalData.name).toBe("Client");
    expect(result.finalData.city).toBe("Delhi");
  });

  it("no-conflict case returns client data directly", () => {
    const result = resolveConflict("server_wins", { name: "Client" }, { ...serverEntity, version: 1 }, 1);
    expect(result.winner).toBe("client");
  });
});

describe("sync/domain — batch validation", () => {
  it("rejects invalid entity type", () => {
    const ops = [{ id: "1", entityType: "invalid", entityId: "x", operation: "create" as const, payload: {}, clientTimestamp: "2025-01-01T00:00:00Z", clientVersion: 1 }];
    expect(validateSyncBatch(ops)).toBe("invalid entity type: invalid");
  });

  it("rejects invalid operation", () => {
    const ops = [{ id: "1", entityType: "task", entityId: "x", operation: "upsert" as any, payload: {}, clientTimestamp: "2025-01-01T00:00:00Z", clientVersion: 1 }];
    expect(validateSyncBatch(ops)).toBe("invalid operation: upsert");
  });

  it("rejects invalid timestamp", () => {
    const ops = [{ id: "1", entityType: "task", entityId: "x", operation: "create" as const, payload: {}, clientTimestamp: "not-a-date", clientVersion: 1 }];
    expect(validateSyncBatch(ops)).toContain("invalid timestamp");
  });

  it("rejects duplicate IDs", () => {
    const ops = [
      { id: "1", entityType: "task", entityId: "x", operation: "create" as const, payload: {}, clientTimestamp: "2025-01-01T00:00:00Z", clientVersion: 1 },
      { id: "1", entityType: "visit", entityId: "y", operation: "update" as const, payload: {}, clientTimestamp: "2025-01-01T00:00:00Z", clientVersion: 1 },
    ];
    expect(validateSyncBatch(ops)).toBe("duplicate operation id: 1");
  });

  it("accepts valid batch", () => {
    const ops = [
      { id: "1", entityType: "task", entityId: "x", operation: "create" as const, payload: {}, clientTimestamp: "2025-01-01T00:00:00Z", clientVersion: 1 },
      { id: "2", entityType: "visit", entityId: "y", operation: "update" as const, payload: {}, clientTimestamp: "2025-01-01T01:00:00Z", clientVersion: 2 },
    ];
    expect(validateSyncBatch(ops)).toBeNull();
  });
});

describe("sync/domain — strategy determination", () => {
  it("creates use client_wins", () => {
    expect(determineStrategy("create")).toBe("client_wins");
  });

  it("deletes use server_wins", () => {
    expect(determineStrategy("delete")).toBe("server_wins");
  });

  it("updates use merge", () => {
    expect(determineStrategy("update")).toBe("merge");
  });
});
