/**
 * Invariant test: C4 — Maker-checker on money paths.
 *
 * PROPERTY: No single actor can both create AND approve/pay a bill.
 * Self-approval on any finance money path is rejected with MAKER_CHECKER_VIOLATION.
 */
import { describe, it, expect } from "vitest";
import { assertDistinctMakerChecker, DomainError } from "../src/modules/payments/domain.js";

const MAKER = "user-aaaa-bbbb-cccc-dddddddddddd";
const CHECKER = "user-1111-2222-3333-444444444444";

describe("C4 — Maker-checker on finance money paths", () => {
  it("rejects self-approval (same maker and checker)", () => {
    expect(() => assertDistinctMakerChecker(MAKER, MAKER)).toThrow(DomainError);
    expect(() => assertDistinctMakerChecker(MAKER, MAKER)).toThrow("MAKER_CHECKER_VIOLATION");
  });

  it("allows distinct maker and checker", () => {
    expect(() => assertDistinctMakerChecker(MAKER, CHECKER)).not.toThrow();
  });

  it("allows empty maker (edge case — system-created bills)", () => {
    expect(() => assertDistinctMakerChecker("", CHECKER)).not.toThrow();
  });

  it("allows empty checker (edge case — should not reach approval logic)", () => {
    expect(() => assertDistinctMakerChecker(MAKER, "")).not.toThrow();
  });

  it("rejects regardless of UUID format (identity comparison)", () => {
    const sameUser = "12345678-abcd-4000-8000-123456789abc";
    expect(() => assertDistinctMakerChecker(sameUser, sameUser)).toThrow(
      "MAKER_CHECKER_VIOLATION",
    );
  });
});
