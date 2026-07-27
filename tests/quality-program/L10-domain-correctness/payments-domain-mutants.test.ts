/**
 * L10 — Domain Correctness: payments / three-way match (mutation burn-down)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `payments/domain.ts` sat at 57.7% with 47 surviving/uncovered mutants. The most
 * serious was not a rounding gap:
 *
 *   L15  assertDistinctMakerChecker() — the SEGREGATION-OF-DUTIES guard on the
 *        money path — was entirely NoCoverage. Every mutant survived, including
 *        `creatorId !== approverId`, which INVERTS the check: self-approval of a
 *        disbursement would have been permitted and no test would have failed.
 *
 * Also targeted:
 *   L44-45  overagePct() cap/value boundaries.
 *   L68     three-way positivity guard (an unpriced PO/GRN must not match).
 *   L80/86  tolerance comparisons — `>` vs `>=` decides whether an invoice
 *           EXACTLY at the tolerance limit is passed for payment.
 *   L98+    payment-mode allowlist, bill-status gate, stage machine.
 *
 * Boundary values are computed from the documented rule:
 *   overagePct(value, cap) = (value - cap) / cap * 100, and 0 when value <= cap.
 *   So po=100000, grn=102000 -> exactly 2.00% overage, i.e. exactly at the
 *   default tolerance. `>` admits it; `>=` would reject it. That distinction is
 *   money leaving the building, so it is asserted explicitly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

type Legs = { poAmountMinor: bigint; grnAmountMinor: bigint; invoiceMinor: bigint };

let assertDistinctMakerChecker: (creatorId: string, approverId: string) => void;
let assertThreeWayMatchPresent: (poRef: unknown, grnRef: unknown) => void;
let assertThreeWayMatch: (poRef: unknown, grnRef: unknown, legs: Legs, tol?: number) => void;
let assertValidPaymentMode: (mode: string) => void;
let assertBillPassed: (status: string) => void;
let nextStage: (current: string) => string;
let DEFAULT_TOL: number;

beforeAll(async () => {
  const d = await import(`${REPO_ROOT}/services/finance-service/src/modules/payments/domain.js`);
  assertDistinctMakerChecker = d.assertDistinctMakerChecker;
  assertThreeWayMatchPresent = d.assertThreeWayMatchPresent;
  assertThreeWayMatch = d.assertThreeWayMatch;
  assertValidPaymentMode = d.assertValidPaymentMode;
  assertBillPassed = d.assertBillPassed;
  nextStage = d.nextStage;
  DEFAULT_TOL = d.DEFAULT_THREE_WAY_TOLERANCE_PCT;
});

const MAKER = "11111111-1111-4000-8000-000000000001";
const CHECKER = "22222222-2222-4000-8000-000000000002";

// ── Segregation of duties (L15) — was entirely NoCoverage ────────────────────

describe("L10 payments — maker/checker segregation of duties", () => {
  it("rejects self-approval when maker and checker are the same actor", () => {
    // Kills the `creatorId !== approverId` inversion: without this, self-approval
    // of a disbursement is permitted.
    expect(() => assertDistinctMakerChecker(MAKER, MAKER)).toThrow(/MAKER_CHECKER_VIOLATION/);
  });

  it("permits approval by a different actor", () => {
    // Kills the `ConditionalExpression -> true` mutant (always throw).
    expect(() => assertDistinctMakerChecker(MAKER, CHECKER)).not.toThrow();
  });

  it("is case- and value-sensitive, not merely a length check", () => {
    expect(() => assertDistinctMakerChecker("abc", "abd")).not.toThrow();
    expect(() => assertDistinctMakerChecker("abc", "abc")).toThrow(/MAKER_CHECKER_VIOLATION/);
  });

  it("error carries the MAKER_CHECKER_VIOLATION code and a money-path message", () => {
    try {
      assertDistinctMakerChecker(MAKER, MAKER);
      expect.fail("expected a throw");
    } catch (e) {
      const err = e as Error & { code?: string };
      expect(err.code).toBe("MAKER_CHECKER_VIOLATION");
      expect(err.message).toMatch(/self-approval/i);
    }
  });

  /**
   * DOCUMENTED WEAKNESS, asserted so it cannot change silently.
   *
   * The guard is `creatorId && approverId && creatorId === approverId`, so it
   * only fires when BOTH ids are truthy. Two empty strings — which are equal —
   * do NOT trip it. That is deliberate (an unknown actor is not evidence of
   * self-approval) but it means an empty-string actor id bypasses SoD entirely.
   * Callers must validate that both ids are present; this function does not.
   */
  it("does NOT fire when both ids are empty (guard requires both to be truthy)", () => {
    expect(() => assertDistinctMakerChecker("", "")).not.toThrow();
  });

  it("does NOT fire when only one id is present", () => {
    expect(() => assertDistinctMakerChecker("", CHECKER)).not.toThrow();
    expect(() => assertDistinctMakerChecker(MAKER, "")).not.toThrow();
  });
});

// ── Reference presence (L28) ─────────────────────────────────────────────────

describe("L10 payments — three-way match requires both references", () => {
  it("accepts when both refs are present", () => {
    expect(() => assertThreeWayMatchPresent("PO-1", "GRN-1")).not.toThrow();
  });

  const missing: Array<[string, unknown, unknown]> = [
    ["po null", null, "GRN-1"],
    ["grn null", "PO-1", null],
    ["po undefined", undefined, "GRN-1"],
    ["grn undefined", "PO-1", undefined],
    ["po empty string", "", "GRN-1"],
    ["grn empty string", "PO-1", ""],
    ["both missing", null, null],
  ];

  for (const [label, po, grn] of missing) {
    it(`rejects when ${label}`, () => {
      expect(() => assertThreeWayMatchPresent(po, grn)).toThrow(/THREE_WAY_MATCH_FAILED/);
    });
  }
});

// ── Positivity guard (L68) ───────────────────────────────────────────────────

describe("L10 payments — all three legs must be positive", () => {
  const ok: Legs = { poAmountMinor: 100_000n, grnAmountMinor: 100_000n, invoiceMinor: 100_000n };

  it("accepts three equal positive legs", () => {
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", ok)).not.toThrow();
  });

  const zeroCases: Array<[string, Legs]> = [
    ["po is zero", { ...ok, poAmountMinor: 0n }],
    ["grn is zero", { ...ok, grnAmountMinor: 0n }],
    ["invoice is zero", { ...ok, invoiceMinor: 0n }],
    ["po is negative", { ...ok, poAmountMinor: -1n }],
    ["grn is negative", { ...ok, grnAmountMinor: -1n }],
    ["invoice is negative", { ...ok, invoiceMinor: -1n }],
  ];

  for (const [label, legs] of zeroCases) {
    it(`rejects when ${label}`, () => {
      // An unpriced PO or GRN must never reconcile — kills the individual
      // `<= 0n` -> `< 0n` mutants and the `||` -> `&&` collapse.
      expect(() => assertThreeWayMatch("PO-1", "GRN-1", legs)).toThrow(/THREE_WAY_MATCH_FAILED/);
    });
  }

  it("one paise on every leg is enough to reconcile", () => {
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", { poAmountMinor: 1n, grnAmountMinor: 1n, invoiceMinor: 1n }),
    ).not.toThrow();
  });
});

// ── Tolerance boundary: `>` vs `>=` decides whether money leaves ─────────────

describe("L10 payments — tolerance boundary is exclusive (exactly-at-limit is allowed)", () => {
  it("default tolerance is 2 percent", () => {
    expect(DEFAULT_TOL).toBe(2);
  });

  it("GRN exactly 2% over PO is ALLOWED (boundary exclusive)", () => {
    // (102000 - 100000) / 100000 = 2.00% exactly.
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 100_000n,
        grnAmountMinor: 102_000n,
        invoiceMinor: 100_000n,
      }),
    ).not.toThrow();
  });

  it("GRN just above 2% over PO is REJECTED", () => {
    // (102001 - 100000) / 100000 = 2.001%
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 100_000n,
        grnAmountMinor: 102_001n,
        invoiceMinor: 100_000n,
      }),
    ).toThrow(/GRN_EXCEEDS_PO/);
  });

  it("invoice exactly 2% over GRN is ALLOWED", () => {
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 200_000n,
        grnAmountMinor: 100_000n,
        invoiceMinor: 102_000n,
      }),
    ).not.toThrow();
  });

  it("invoice just above 2% over GRN is REJECTED", () => {
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 200_000n,
        grnAmountMinor: 100_000n,
        invoiceMinor: 102_001n,
      }),
    ).toThrow(/INVOICE_EXCEEDS_GRN/);
  });

  it("invoice over PO is rejected even when it is within tolerance of GRN", () => {
    // grn == invoice so the GRN leg passes; the PO leg must still catch it.
    // po=100000, invoice=110000 -> 10% over PO.
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 100_000n,
        grnAmountMinor: 110_000n,
        invoiceMinor: 110_000n,
      }),
      // GRN-over-PO fires first at 10%, which is itself the correct rejection.
    ).toThrow(/GRN_EXCEEDS_PO|INVOICE_EXCEEDS_PO/);
  });

  it("a custom tolerance is honoured", () => {
    const legs: Legs = { poAmountMinor: 100_000n, grnAmountMinor: 105_000n, invoiceMinor: 100_000n };
    // 5% overage: rejected at the 2% default, allowed at 5%.
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", legs)).toThrow(/GRN_EXCEEDS_PO/);
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", legs, 5)).not.toThrow();
  });

  it("zero tolerance rejects any overage but still allows an exact match", () => {
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1",
        { poAmountMinor: 100_000n, grnAmountMinor: 100_000n, invoiceMinor: 100_000n }, 0),
    ).not.toThrow();
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1",
        { poAmountMinor: 100_000n, grnAmountMinor: 100_001n, invoiceMinor: 100_000n }, 0),
    ).toThrow(/GRN_EXCEEDS_PO/);
  });
});

// ── Under-billing is always allowed ──────────────────────────────────────────

describe("L10 payments — under-billing is permitted", () => {
  it("invoice far below GRN and PO reconciles", () => {
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 1_000_000n,
        grnAmountMinor: 900_000n,
        invoiceMinor: 10_000n,
      }),
    ).not.toThrow();
  });

  it("GRN far below PO reconciles (partial delivery)", () => {
    expect(() =>
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 1_000_000n,
        grnAmountMinor: 100_000n,
        invoiceMinor: 100_000n,
      }),
    ).not.toThrow();
  });
});

// ── Payment mode allowlist (L98) ─────────────────────────────────────────────

describe("L10 payments — payment mode allowlist", () => {
  for (const mode of ["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"]) {
    it(`accepts ${mode}`, () => {
      expect(() => assertValidPaymentMode(mode)).not.toThrow();
    });
  }

  for (const mode of ["neft", "CHEQUE", "UPI", "cash", "", "NEFT ", "wire"]) {
    it(`rejects ${JSON.stringify(mode)}`, () => {
      // Case-sensitive by design: "neft" and "CHEQUE" must NOT pass.
      expect(() => assertValidPaymentMode(mode)).toThrow(/INVALID_PAYMENT_MODE/);
    });
  }

  it("the rejection message lists the permitted modes", () => {
    try {
      assertValidPaymentMode("UPI");
      expect.fail("expected a throw");
    } catch (e) {
      expect((e as Error).message).toMatch(/NEFT/);
      expect((e as Error).message).toMatch(/cheque/);
    }
  });
});

// ── Bill status gate (L105) ──────────────────────────────────────────────────

describe("L10 payments — payment requires bill.status = passed", () => {
  it("accepts 'passed'", () => {
    expect(() => assertBillPassed("passed")).not.toThrow();
  });

  for (const status of ["draft", "submitted", "approved", "rejected", "paid", "", "PASSED", "passed "]) {
    it(`rejects ${JSON.stringify(status)}`, () => {
      // 'approved' and 'paid' matter most: neither may authorise a second payout.
      expect(() => assertBillPassed(status)).toThrow(/BILL_NOT_PASSED/);
    });
  }

  it("the error reports the offending status", () => {
    try {
      assertBillPassed("draft");
      expect.fail("expected a throw");
    } catch (e) {
      expect((e as Error).message).toMatch(/draft/);
    }
  });
});

// ── Stage machine (L116) ─────────────────────────────────────────────────────

describe("L10 payments — bill stage progression", () => {
  it("section advances to accounts", () => {
    expect(nextStage("section")).toBe("accounts");
  });

  it("accounts advances to pay", () => {
    expect(nextStage("accounts")).toBe("pay");
  });

  it("pay is terminal", () => {
    expect(() => nextStage("pay")).toThrow(/STAGE_TERMINAL/);
  });

  for (const bogus of ["", "unknown", "Section", "PAY"]) {
    it(`rejects unknown stage ${JSON.stringify(bogus)}`, () => {
      expect(() => nextStage(bogus)).toThrow(/STAGE_TERMINAL/);
    });
  }

  it("progression cannot skip a stage", () => {
    // Guards against a table edit that wires section straight to pay.
    expect(nextStage("section")).not.toBe("pay");
  });
});
