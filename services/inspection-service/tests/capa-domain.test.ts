/**
 * Unit tests for CAPA domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: SVC-106
 */
import { describe, it, expect } from "vitest";
import {
  CAPA_STATES,
  CAPA_TYPES,
  CAPA_TRANSITIONS,
  assertValidCapaTransition,
  validateEffectivenessEvidence,
  isOverdue,
  assertMakerCheckerForVerification,
  DomainError,
} from "../src/modules/capa/domain.js";
import type { CapaState } from "../src/modules/capa/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("CAPA_STATES", () => {
  it("contains exactly 5 states", () => {
    expect(CAPA_STATES).toHaveLength(5);
  });

  it("includes all expected states", () => {
    expect(CAPA_STATES).toContain("open");
    expect(CAPA_STATES).toContain("in_progress");
    expect(CAPA_STATES).toContain("completed");
    expect(CAPA_STATES).toContain("verified");
    expect(CAPA_STATES).toContain("overdue");
  });
});

describe("CAPA_TYPES", () => {
  it("contains exactly 2 types", () => {
    expect(CAPA_TYPES).toHaveLength(2);
  });

  it("includes corrective and preventive", () => {
    expect(CAPA_TYPES).toContain("corrective");
    expect(CAPA_TYPES).toContain("preventive");
  });
});

// ── assertValidCapaTransition ─────────────────────────────────────────────────

describe("assertValidCapaTransition", () => {
  it("allows open → in_progress", () => {
    expect(() => assertValidCapaTransition("open", "in_progress"))
      .not.toThrow();
  });

  it("allows open → overdue", () => {
    expect(() => assertValidCapaTransition("open", "overdue"))
      .not.toThrow();
  });

  it("allows in_progress → completed", () => {
    expect(() => assertValidCapaTransition("in_progress", "completed"))
      .not.toThrow();
  });

  it("allows in_progress → overdue", () => {
    expect(() => assertValidCapaTransition("in_progress", "overdue"))
      .not.toThrow();
  });

  it("allows completed → verified", () => {
    expect(() => assertValidCapaTransition("completed", "verified"))
      .not.toThrow();
  });

  it("allows overdue → in_progress", () => {
    expect(() => assertValidCapaTransition("overdue", "in_progress"))
      .not.toThrow();
  });

  it("allows overdue → completed", () => {
    expect(() => assertValidCapaTransition("overdue", "completed"))
      .not.toThrow();
  });

  it("throws for verified → any (terminal state)", () => {
    expect(() => assertValidCapaTransition("verified", "open"))
      .toThrow(DomainError);
    expect(() => assertValidCapaTransition("verified", "in_progress"))
      .toThrow(DomainError);
  });

  it("throws for open → verified (must go through completed)", () => {
    expect(() => assertValidCapaTransition("open", "verified"))
      .toThrow(DomainError);
  });

  it("throws for open → completed (must go through in_progress)", () => {
    expect(() => assertValidCapaTransition("open", "completed"))
      .toThrow(DomainError);
  });

  it("error message includes current and target states", () => {
    expect(() => assertValidCapaTransition("verified", "open"))
      .toThrow("verified");
  });

  it("error code is INVALID_TRANSITION", () => {
    try {
      assertValidCapaTransition("verified", "open");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });
});

// ── validateEffectivenessEvidence ─────────────────────────────────────────────

describe("validateEffectivenessEvidence", () => {
  it("does not throw for array with 1 item", () => {
    expect(() => validateEffectivenessEvidence([{ id: "ev-1" }]))
      .not.toThrow();
  });

  it("does not throw for array with multiple items", () => {
    expect(() => validateEffectivenessEvidence([{ id: "ev-1" }, { id: "ev-2" }]))
      .not.toThrow();
  });

  it("throws INSUFFICIENT_EVIDENCE for empty array", () => {
    try {
      validateEffectivenessEvidence([]);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INSUFFICIENT_EVIDENCE");
    }
  });

  it("throws INSUFFICIENT_EVIDENCE for null", () => {
    expect(() => validateEffectivenessEvidence(null)).toThrow(DomainError);
  });

  it("throws INSUFFICIENT_EVIDENCE for undefined", () => {
    expect(() => validateEffectivenessEvidence(undefined)).toThrow(DomainError);
  });

  it("throws INSUFFICIENT_EVIDENCE for non-array", () => {
    expect(() => validateEffectivenessEvidence("string")).toThrow(DomainError);
    expect(() => validateEffectivenessEvidence(42)).toThrow(DomainError);
    expect(() => validateEffectivenessEvidence({})).toThrow(DomainError);
  });
});

// ── isOverdue ─────────────────────────────────────────────────────────────────

describe("isOverdue", () => {
  it("returns true when due date is in the past and status is open", () => {
    const pastDate = "2020-01-01";
    expect(isOverdue(pastDate, "open")).toBe(true);
  });

  it("returns true when due date is in the past and status is in_progress", () => {
    const pastDate = "2020-01-01";
    expect(isOverdue(pastDate, "in_progress")).toBe(true);
  });

  it("returns false when status is completed", () => {
    const pastDate = "2020-01-01";
    expect(isOverdue(pastDate, "completed")).toBe(false);
  });

  it("returns false when status is verified", () => {
    const pastDate = "2020-01-01";
    expect(isOverdue(pastDate, "verified")).toBe(false);
  });

  it("returns false when due date is in the future", () => {
    const futureDate = "2099-12-31";
    expect(isOverdue(futureDate, "open")).toBe(false);
  });
});

// ── assertMakerCheckerForVerification ─────────────────────────────────────────

describe("assertMakerCheckerForVerification", () => {
  it("does not throw when creator and verifier are different", () => {
    expect(() => assertMakerCheckerForVerification("user-a", "user-b"))
      .not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION when same user", () => {
    try {
      assertMakerCheckerForVerification("user-a", "user-a");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("MAKER_CHECKER_VIOLATION");
    }
  });

  it("error message mentions maker-checker", () => {
    expect(() => assertMakerCheckerForVerification("same", "same"))
      .toThrow("maker-checker");
  });
});
