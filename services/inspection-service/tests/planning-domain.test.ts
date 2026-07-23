/**
 * Unit tests for planning domain logic — plan lifecycle state machine and entity selection.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7
 */
import { describe, it, expect } from "vitest";
import {
  PLAN_STATES,
  PLAN_TRANSITIONS,
  assertValidPlanTransition,
  assertPlanModifiable,
  selectEntitiesByCriteria,
  DomainError,
  type PlanState,
  type EntityCandidate,
  type SelectionCriteria,
} from "../src/modules/planning/domain.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<EntityCandidate> = {}): EntityCandidate {
  return {
    id: overrides.id ?? "entity-1",
    riskScore: overrides.riskScore ?? 50,
    lastInspectionDate: "lastInspectionDate" in overrides ? overrides.lastInspectionDate! : "2024-01-01",
    riskCategory: overrides.riskCategory ?? "medium",
  };
}

// ── PLAN_STATES ───────────────────────────────────────────────────────────────

describe("PLAN_STATES", () => {
  it("contains exactly three states in order", () => {
    expect(PLAN_STATES).toEqual(["draft", "pending_approval", "active"]);
  });
});

// ── PLAN_TRANSITIONS ──────────────────────────────────────────────────────────

describe("PLAN_TRANSITIONS", () => {
  it("draft can transition to pending_approval", () => {
    expect(PLAN_TRANSITIONS.draft).toEqual(["pending_approval"]);
  });

  it("pending_approval can transition to active or draft", () => {
    expect(PLAN_TRANSITIONS.pending_approval).toEqual(["active", "draft"]);
  });

  it("active is a terminal state with no transitions", () => {
    expect(PLAN_TRANSITIONS.active).toEqual([]);
  });
});

// ── assertValidPlanTransition ─────────────────────────────────────────────────

describe("assertValidPlanTransition", () => {
  it("allows draft → pending_approval", () => {
    expect(() => assertValidPlanTransition("draft", "pending_approval")).not.toThrow();
  });

  it("allows pending_approval → active", () => {
    expect(() => assertValidPlanTransition("pending_approval", "active")).not.toThrow();
  });

  it("allows pending_approval → draft (rejection)", () => {
    expect(() => assertValidPlanTransition("pending_approval", "draft")).not.toThrow();
  });

  it("rejects draft → active (must go through pending_approval)", () => {
    expect(() => assertValidPlanTransition("draft", "active")).toThrow(DomainError);
  });

  it("rejects active → draft (terminal state)", () => {
    expect(() => assertValidPlanTransition("active", "draft")).toThrow(DomainError);
  });

  it("rejects active → pending_approval (terminal state)", () => {
    expect(() => assertValidPlanTransition("active", "pending_approval")).toThrow(DomainError);
  });

  it("throws DomainError with code INVALID_PLAN_TRANSITION", () => {
    try {
      assertValidPlanTransition("active", "draft");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_PLAN_TRANSITION");
    }
  });

  it("error message includes current and target states", () => {
    try {
      assertValidPlanTransition("draft", "active");
    } catch (e) {
      expect((e as DomainError).message).toContain("draft");
      expect((e as DomainError).message).toContain("active");
    }
  });

  it("error message indicates terminal state for active", () => {
    try {
      assertValidPlanTransition("active", "draft");
    } catch (e) {
      expect((e as DomainError).message).toContain("terminal state");
    }
  });
});

// ── assertPlanModifiable ──────────────────────────────────────────────────────

describe("assertPlanModifiable", () => {
  it("does not throw for draft status", () => {
    expect(() => assertPlanModifiable("draft")).not.toThrow();
  });

  it("throws DomainError for pending_approval status", () => {
    expect(() => assertPlanModifiable("pending_approval")).toThrow(DomainError);
  });

  it("throws DomainError for active status", () => {
    expect(() => assertPlanModifiable("active")).toThrow(DomainError);
  });

  it("thrown error has code PLAN_NOT_MODIFIABLE", () => {
    try {
      assertPlanModifiable("active");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("PLAN_NOT_MODIFIABLE");
    }
  });

  it("error message includes current status", () => {
    try {
      assertPlanModifiable("pending_approval");
    } catch (e) {
      expect((e as DomainError).message).toContain("pending_approval");
    }
  });
});

// ── selectEntitiesByCriteria ──────────────────────────────────────────────────

describe("selectEntitiesByCriteria", () => {
  const referenceDate = new Date("2024-07-01");

  describe("risk threshold selection", () => {
    it("selects entities with risk score >= threshold", () => {
      const entities = [
        makeEntity({ id: "high", riskScore: 80 }),
        makeEntity({ id: "low", riskScore: 30 }),
        makeEntity({ id: "exact", riskScore: 60 }),
      ];
      const criteria: SelectionCriteria = { riskThreshold: 60 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["high", "exact"]);
    });

    it("excludes all entities when none meet the threshold", () => {
      const entities = [
        makeEntity({ id: "a", riskScore: 20 }),
        makeEntity({ id: "b", riskScore: 40 }),
      ];
      const criteria: SelectionCriteria = { riskThreshold: 90 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result).toHaveLength(0);
    });

    it("includes all entities when threshold is 0", () => {
      const entities = [
        makeEntity({ id: "a", riskScore: 0 }),
        makeEntity({ id: "b", riskScore: 50 }),
      ];
      const criteria: SelectionCriteria = { riskThreshold: 0 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result).toHaveLength(2);
    });
  });

  describe("last inspection date selection", () => {
    it("selects entities whose last inspection exceeds maxDaysSinceLastInspection", () => {
      const entities = [
        makeEntity({ id: "old", lastInspectionDate: "2024-01-01" }), // 182 days ago
        makeEntity({ id: "recent", lastInspectionDate: "2024-06-15" }), // 16 days ago
      ];
      const criteria: SelectionCriteria = { maxDaysSinceLastInspection: 90 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["old"]);
    });

    it("does not select never-inspected entities on maxDaysSinceLastInspection alone", () => {
      const entities = [
        makeEntity({ id: "never", lastInspectionDate: null }),
      ];
      const criteria: SelectionCriteria = { maxDaysSinceLastInspection: 30 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result).toHaveLength(0);
    });
  });

  describe("mandatory frequency selection", () => {
    it("selects entities overdue by mandatory frequency", () => {
      const entities = [
        makeEntity({ id: "overdue", lastInspectionDate: "2023-06-01" }), // 396 days ago
        makeEntity({ id: "ok", lastInspectionDate: "2024-05-01" }), // 61 days ago
      ];
      const criteria: SelectionCriteria = { mandatoryFrequencyDays: 365 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["overdue"]);
    });

    it("always selects never-inspected entities for mandatory frequency", () => {
      const entities = [
        makeEntity({ id: "never", lastInspectionDate: null }),
      ];
      const criteria: SelectionCriteria = { mandatoryFrequencyDays: 365 };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["never"]);
    });
  });

  describe("combined criteria (OR logic)", () => {
    it("selects entities matching any of the criteria", () => {
      const entities = [
        makeEntity({ id: "high-risk", riskScore: 90, lastInspectionDate: "2024-06-30" }),
        makeEntity({ id: "overdue", riskScore: 20, lastInspectionDate: "2023-01-01" }),
        makeEntity({ id: "neither", riskScore: 20, lastInspectionDate: "2024-06-30" }),
      ];
      const criteria: SelectionCriteria = {
        riskThreshold: 80,
        maxDaysSinceLastInspection: 180,
      };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["high-risk", "overdue"]);
    });
  });

  describe("risk category pre-filter", () => {
    it("restricts selection to specified risk categories", () => {
      const entities = [
        makeEntity({ id: "high-cat", riskScore: 90, riskCategory: "high" }),
        makeEntity({ id: "med-cat", riskScore: 90, riskCategory: "medium" }),
      ];
      const criteria: SelectionCriteria = {
        riskThreshold: 50,
        riskCategories: ["high"],
      };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["high-cat"]);
    });

    it("returns empty when no entities match the category filter", () => {
      const entities = [
        makeEntity({ id: "a", riskScore: 90, riskCategory: "low" }),
      ];
      const criteria: SelectionCriteria = {
        riskThreshold: 50,
        riskCategories: ["high"],
      };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result).toHaveLength(0);
    });
  });

  describe("no criteria specified", () => {
    it("returns all entities when no criteria are given", () => {
      const entities = [
        makeEntity({ id: "a" }),
        makeEntity({ id: "b" }),
      ];
      const criteria: SelectionCriteria = {};

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result).toHaveLength(2);
    });

    it("returns all entities within category filter when no scoring criteria are given", () => {
      const entities = [
        makeEntity({ id: "a", riskCategory: "high" }),
        makeEntity({ id: "b", riskCategory: "low" }),
      ];
      const criteria: SelectionCriteria = { riskCategories: ["high"] };

      const result = selectEntitiesByCriteria(entities, criteria, referenceDate);

      expect(result.map((e) => e.id)).toEqual(["a"]);
    });
  });

  describe("empty inputs", () => {
    it("returns empty array when entities list is empty", () => {
      const criteria: SelectionCriteria = { riskThreshold: 50 };

      const result = selectEntitiesByCriteria([], criteria, referenceDate);

      expect(result).toHaveLength(0);
    });
  });
});
