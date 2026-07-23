/**
 * Unit tests for findings domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6, 9.8
 */
import { describe, it, expect } from "vitest";
import {
  FINDING_STATES,
  FINDING_TRANSITIONS,
  SEVERITY_LEVELS,
  PROTECTED_INSPECTION_STATES,
  assertValidFindingTransition,
  generateFindingNumber,
  deriveSeverity,
  assertDeletionAllowed,
  DomainError,
} from "../src/modules/findings/domain.js";
import type { FindingState } from "../src/modules/findings/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("FINDING_STATES", () => {
  it("contains exactly 4 states", () => {
    expect(FINDING_STATES).toHaveLength(4);
  });

  it("includes open, notice_issued, overdue, closed", () => {
    expect(FINDING_STATES).toContain("open");
    expect(FINDING_STATES).toContain("notice_issued");
    expect(FINDING_STATES).toContain("overdue");
    expect(FINDING_STATES).toContain("closed");
  });
});

describe("FINDING_TRANSITIONS", () => {
  it("allows open → notice_issued", () => {
    expect(FINDING_TRANSITIONS.open).toContain("notice_issued");
  });

  it("allows open → closed", () => {
    expect(FINDING_TRANSITIONS.open).toContain("closed");
  });

  it("allows notice_issued → overdue", () => {
    expect(FINDING_TRANSITIONS.notice_issued).toContain("overdue");
  });

  it("allows notice_issued → closed", () => {
    expect(FINDING_TRANSITIONS.notice_issued).toContain("closed");
  });

  it("allows overdue → closed", () => {
    expect(FINDING_TRANSITIONS.overdue).toContain("closed");
  });

  it("closed has no valid transitions", () => {
    expect(FINDING_TRANSITIONS.closed).toHaveLength(0);
  });
});

describe("SEVERITY_LEVELS", () => {
  it("contains exactly 4 levels", () => {
    expect(SEVERITY_LEVELS).toHaveLength(4);
  });

  it("includes critical, major, minor, observation", () => {
    expect(SEVERITY_LEVELS).toContain("critical");
    expect(SEVERITY_LEVELS).toContain("major");
    expect(SEVERITY_LEVELS).toContain("minor");
    expect(SEVERITY_LEVELS).toContain("observation");
  });
});

describe("PROTECTED_INSPECTION_STATES", () => {
  it("contains under_review and finalized", () => {
    expect(PROTECTED_INSPECTION_STATES).toContain("under_review");
    expect(PROTECTED_INSPECTION_STATES).toContain("finalized");
  });

  it("contains exactly 2 states", () => {
    expect(PROTECTED_INSPECTION_STATES).toHaveLength(2);
  });
});

// ── assertValidFindingTransition ──────────────────────────────────────────────

describe("assertValidFindingTransition", () => {
  it("does not throw for open → notice_issued", () => {
    expect(() => assertValidFindingTransition("open", "notice_issued")).not.toThrow();
  });

  it("does not throw for open → closed", () => {
    expect(() => assertValidFindingTransition("open", "closed")).not.toThrow();
  });

  it("does not throw for notice_issued → overdue", () => {
    expect(() => assertValidFindingTransition("notice_issued", "overdue")).not.toThrow();
  });

  it("does not throw for notice_issued → closed", () => {
    expect(() => assertValidFindingTransition("notice_issued", "closed")).not.toThrow();
  });

  it("does not throw for overdue → closed", () => {
    expect(() => assertValidFindingTransition("overdue", "closed")).not.toThrow();
  });

  it("throws INVALID_TRANSITION for closed → open", () => {
    try {
      assertValidFindingTransition("closed", "open");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("throws INVALID_TRANSITION for open → overdue (must go through notice_issued)", () => {
    expect(() => assertValidFindingTransition("open", "overdue")).toThrow(DomainError);
  });

  it("throws INVALID_TRANSITION for overdue → notice_issued (backward transition)", () => {
    expect(() => assertValidFindingTransition("overdue", "notice_issued")).toThrow(DomainError);
  });

  it("throws INVALID_TRANSITION for self-transition on closed", () => {
    expect(() => assertValidFindingTransition("closed", "closed")).toThrow(DomainError);
  });

  it("error message includes current and target states", () => {
    expect(() => assertValidFindingTransition("closed", "open")).toThrow("closed");
    expect(() => assertValidFindingTransition("closed", "open")).toThrow("open");
  });
});

// ── generateFindingNumber ─────────────────────────────────────────────────────

describe("generateFindingNumber", () => {
  it("generates FND-2025-000001 for year 2025 seq 1", () => {
    expect(generateFindingNumber(2025, 1)).toBe("FND-2025-000001");
  });

  it("generates FND-2024-000123 for year 2024 seq 123", () => {
    expect(generateFindingNumber(2024, 123)).toBe("FND-2024-000123");
  });

  it("generates FND-2025-999999 for max 6-digit sequence", () => {
    expect(generateFindingNumber(2025, 999999)).toBe("FND-2025-999999");
  });

  it("generates FND-2025-1000000 for seq exceeding 6 digits (no truncation)", () => {
    expect(generateFindingNumber(2025, 1000000)).toBe("FND-2025-1000000");
  });

  it("throws INVALID_SEQUENCE for seq 0", () => {
    try {
      generateFindingNumber(2025, 0);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_SEQUENCE");
    }
  });

  it("throws INVALID_SEQUENCE for negative seq", () => {
    expect(() => generateFindingNumber(2025, -1)).toThrow(DomainError);
  });

  it("throws INVALID_SEQUENCE for non-integer seq", () => {
    expect(() => generateFindingNumber(2025, 1.5)).toThrow(DomainError);
  });

  it("throws INVALID_YEAR for 3-digit year", () => {
    try {
      generateFindingNumber(999, 1);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_YEAR");
    }
  });

  it("throws INVALID_YEAR for 5-digit year", () => {
    expect(() => generateFindingNumber(10000, 1)).toThrow(DomainError);
  });

  it("throws INVALID_YEAR for non-integer year", () => {
    expect(() => generateFindingNumber(2025.5, 1)).toThrow(DomainError);
  });
});

// ── deriveSeverity ────────────────────────────────────────────────────────────

describe("deriveSeverity", () => {
  it("returns 'critical' for 'critical' input", () => {
    expect(deriveSeverity("critical")).toBe("critical");
  });

  it("returns 'major' for 'major' input", () => {
    expect(deriveSeverity("major")).toBe("major");
  });

  it("returns 'minor' for 'minor' input", () => {
    expect(deriveSeverity("minor")).toBe("minor");
  });

  it("returns 'observation' for 'observation' input", () => {
    expect(deriveSeverity("observation")).toBe("observation");
  });

  it("throws INVALID_SEVERITY for unknown severity", () => {
    try {
      deriveSeverity("high");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_SEVERITY");
    }
  });

  it("throws INVALID_SEVERITY for empty string", () => {
    expect(() => deriveSeverity("")).toThrow(DomainError);
  });

  it("throws INVALID_SEVERITY for capitalized input (case-sensitive)", () => {
    expect(() => deriveSeverity("Critical")).toThrow(DomainError);
  });

  it("error message includes the invalid severity class", () => {
    expect(() => deriveSeverity("unknown")).toThrow("unknown");
  });
});

// ── assertDeletionAllowed ─────────────────────────────────────────────────────

describe("assertDeletionAllowed", () => {
  it("does not throw for 'scheduled' inspection state", () => {
    expect(() => assertDeletionAllowed("scheduled")).not.toThrow();
  });

  it("does not throw for 'in_progress' inspection state", () => {
    expect(() => assertDeletionAllowed("in_progress")).not.toThrow();
  });

  it("does not throw for 'paused' inspection state", () => {
    expect(() => assertDeletionAllowed("paused")).not.toThrow();
  });

  it("does not throw for 'completed' inspection state", () => {
    expect(() => assertDeletionAllowed("completed")).not.toThrow();
  });

  it("throws DELETION_PROTECTED for 'under_review' inspection state", () => {
    try {
      assertDeletionAllowed("under_review");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("DELETION_PROTECTED");
    }
  });

  it("throws DELETION_PROTECTED for 'finalized' inspection state", () => {
    try {
      assertDeletionAllowed("finalized");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("DELETION_PROTECTED");
    }
  });

  it("error message includes the protected state name", () => {
    expect(() => assertDeletionAllowed("under_review")).toThrow("under_review");
    expect(() => assertDeletionAllowed("finalized")).toThrow("finalized");
  });
});
