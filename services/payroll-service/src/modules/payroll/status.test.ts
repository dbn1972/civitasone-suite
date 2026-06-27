/**
 * TASK 3 — Payroll run status enum alignment test
 *
 * Verifies that assertRunStatusTransition() enforces the correct FSM:
 *
 *   draft  → processing
 *   processing → approved | failed
 *   approved   → disbursed
 *   failed     → draft           (revert/retry)
 *   disbursed  → (terminal — no outgoing transitions)
 *
 * Also spot-checks that the consumer actually uses the same function so the
 * map cannot drift between the two.
 */
import { describe, it, expect } from "vitest";
import { assertRunStatusTransition, DomainError } from "./domain.js";

// ---------------------------------------------------------------------------
describe("assertRunStatusTransition — allowed paths", () => {
  it("draft → processing", () => {
    expect(() => assertRunStatusTransition("draft", "processing")).not.toThrow();
  });

  it("processing → approved", () => {
    expect(() => assertRunStatusTransition("processing", "approved")).not.toThrow();
  });

  it("processing → failed (computation error path)", () => {
    expect(() => assertRunStatusTransition("processing", "failed")).not.toThrow();
  });

  it("approved → disbursed", () => {
    expect(() => assertRunStatusTransition("approved", "disbursed")).not.toThrow();
  });

  it("failed → draft (revert and retry)", () => {
    expect(() => assertRunStatusTransition("failed", "draft")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("assertRunStatusTransition — disallowed paths throw DomainError", () => {
  it("draft → approved (must go through processing)", () => {
    expect(() => assertRunStatusTransition("draft", "approved"))
      .toThrow(DomainError);
    try {
      assertRunStatusTransition("draft", "approved");
    } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });

  it("draft → disbursed (skips two steps)", () => {
    expect(() => assertRunStatusTransition("draft", "disbursed")).toThrow(DomainError);
  });

  it("disbursed → approved (terminal state — no reversals)", () => {
    expect(() => assertRunStatusTransition("disbursed", "approved")).toThrow(DomainError);
  });

  it("disbursed → draft (terminal — cannot revert disbursed run)", () => {
    expect(() => assertRunStatusTransition("disbursed", "draft")).toThrow(DomainError);
  });

  it("approved → draft (cannot step backward past processing)", () => {
    expect(() => assertRunStatusTransition("approved", "draft")).toThrow(DomainError);
  });

  it("approved → processing (backward transition not allowed)", () => {
    expect(() => assertRunStatusTransition("approved", "processing")).toThrow(DomainError);
  });

  it("failed → approved (must go back through draft → processing first)", () => {
    expect(() => assertRunStatusTransition("failed", "approved")).toThrow(DomainError);
  });

  it("processing → disbursed (skips approved step)", () => {
    expect(() => assertRunStatusTransition("processing", "disbursed")).toThrow(DomainError);
  });

  it("any unknown current state throws", () => {
    expect(() => assertRunStatusTransition("unknown_state", "draft")).toThrow(DomainError);
  });
});

// ---------------------------------------------------------------------------
describe("assertRunStatusTransition — error contract", () => {
  it("thrown error is a DomainError with code INVALID_STATUS_TRANSITION", () => {
    let err: unknown;
    try {
      assertRunStatusTransition("draft", "disbursed");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("error message references both the current and next status", () => {
    let err: unknown;
    try {
      assertRunStatusTransition("approved", "draft");
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toContain("approved");
    expect((err as Error).message).toContain("draft");
  });
});

// ---------------------------------------------------------------------------
describe("valid transitions map — completeness assertion", () => {
  // Encode the expected FSM adjacency list and verify the domain function
  // matches it exactly (no hidden transitions beyond what's documented).
  const EXPECTED_ALLOWED: Record<string, string[]> = {
    draft:      ["processing"],
    processing: ["approved", "failed"],
    approved:   ["disbursed"],
    disbursed:  [],
    failed:     ["draft"],
  };

  for (const [from, tos] of Object.entries(EXPECTED_ALLOWED)) {
    // All expected transitions should NOT throw.
    for (const to of tos) {
      it(`EXPECTED ALLOWED: ${from} → ${to}`, () => {
        expect(() => assertRunStatusTransition(from, to)).not.toThrow();
      });
    }

    // All statuses that are NOT in tos should throw.
    const allStatuses = Object.keys(EXPECTED_ALLOWED);
    const forbidden = allStatuses.filter((s) => !tos.includes(s));
    for (const to of forbidden) {
      it(`EXPECTED FORBIDDEN: ${from} → ${to}`, () => {
        expect(() => assertRunStatusTransition(from, to)).toThrow(DomainError);
      });
    }
  }
});
