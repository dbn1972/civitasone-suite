/**
 * G18 — outcome capture with reason codes: DOMAIN tests
 * (src/modules/outcomes/domain.ts).
 *
 * Pure functions only: no database, no bus, no clock. Every branch of
 * `validateOutcome` is exercised, plus the two things that are easy to get
 * quietly wrong:
 *
 *  - MONEY parsing. `parseMinorUnits` must accept only a decimal string of
 *    non-negative minor units and must be EXACT above 2^53, where `Number`
 *    silently rounds. That rounding is asserted explicitly so the test fails if
 *    somebody "simplifies" the parser back to Number().
 *  - the propensity signal, which is on the event precisely so that the model,
 *    cross-sell attribution and analytics cannot disagree about it.
 *
 * No tenant ids, no database rows, nothing to tear down.
 */
import { describe, it, expect } from "vitest";
import {
  VIOLATIONS,
  isReasonCodeApplicable,
  nextVersionNumber,
  parseMinorUnits,
  propensitySignal,
  validateOutcome,
  type OutcomeCandidate,
} from "../src/modules/outcomes/domain.js";
import { OUTCOME_TYPES, type OutcomeType } from "../src/modules/outcomes/schema.js";

/** 2^53 + 1 — the smallest integer an IEEE-754 double cannot represent. */
const ABOVE_2_53 = 9_007_199_254_740_993n;

function candidate(o: Partial<OutcomeCandidate> = {}): OutcomeCandidate {
  return {
    outcomeType: "declined",
    reasonCode: { code: "moved_to_other_provider", active: true, appliesTo: [] },
    productId: null,
    amountMinor: null,
    currency: null,
    followUpNextActionId: null,
    ...o,
  };
}

function codes(violations: ReturnType<typeof validateOutcome>): string[] {
  return violations.map((v) => v.code).sort();
}

describe("parseMinorUnits", () => {
  it("parses a plain decimal string of minor units", () => {
    expect(parseMinorUnits("0")).toBe(0n);
    expect(parseMinorUnits("1")).toBe(1n);
    expect(parseMinorUnits("250000")).toBe(250000n);
  });

  it("MONEY: is exact above 2^53, where Number is not", () => {
    expect(parseMinorUnits(ABOVE_2_53.toString())).toBe(ABOVE_2_53);
    // Proof the value really is outside double range: a Number round trip
    // rounds down and loses the trailing 1.
    expect(BigInt(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
  });

  it("refuses anything that is not a non-negative integer string", () => {
    for (const bad of ["", " ", "-1", "1.5", "1e3", "1_000", "12,00", "abc", "+7", "0x10", " 7 "]) {
      expect(parseMinorUnits(bad), `input ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("refuses an absurdly long literal rather than allocating it", () => {
    expect(parseMinorUnits("9".repeat(26))).toBeNull();
    expect(parseMinorUnits("9".repeat(25))).toBe(BigInt("9".repeat(25)));
  });
});

describe("propensitySignal", () => {
  it("scores converted +1, deferred 0, declined -1", () => {
    expect(propensitySignal("converted")).toBe(1);
    expect(propensitySignal("deferred")).toBe(0);
    expect(propensitySignal("declined")).toBe(-1);
  });

  it("has a signal for every outcome type in the vocabulary", () => {
    for (const t of OUTCOME_TYPES) {
      expect([1, 0, -1]).toContain(propensitySignal(t));
    }
  });
});

describe("isReasonCodeApplicable", () => {
  it("an empty applies-to list means the code applies to every outcome type", () => {
    for (const t of OUTCOME_TYPES) {
      expect(isReasonCodeApplicable([], t)).toBe(true);
    }
  });

  it("a populated list restricts the code to the listed types", () => {
    expect(isReasonCodeApplicable(["declined"], "declined")).toBe(true);
    expect(isReasonCodeApplicable(["declined"], "converted")).toBe(false);
    expect(isReasonCodeApplicable(["declined", "deferred"], "deferred")).toBe(true);
  });
});

describe("validateOutcome — the three outcome-type rules", () => {
  it("accepts a declined outcome that carries an applicable reason code", () => {
    expect(validateOutcome(candidate())).toEqual([]);
  });

  it("declined without a reason code is refused — 'no' must be explainable", () => {
    expect(codes(validateOutcome(candidate({ reasonCode: null }))))
      .toEqual([VIOLATIONS.reasonCodeRequired]);
  });

  it("converted must name the product the customer took", () => {
    expect(codes(validateOutcome(candidate({ outcomeType: "converted", reasonCode: null }))))
      .toEqual([VIOLATIONS.productRequired]);
    expect(validateOutcome(candidate({
      outcomeType: "converted",
      reasonCode: null,
      productId: "1f2b1e5e-0000-4000-8000-000000000001",
    }))).toEqual([]);
  });

  it("deferred must reference a scheduled follow-up, so 'undecided' cannot mean 'dropped'", () => {
    expect(codes(validateOutcome(candidate({ outcomeType: "deferred", reasonCode: null }))))
      .toEqual([VIOLATIONS.followUpRequired]);
    expect(validateOutcome(candidate({
      outcomeType: "deferred",
      reasonCode: null,
      followUpNextActionId: "1f2b1e5e-0000-4000-8000-000000000002",
    }))).toEqual([]);
  });

  it("a converted outcome may still carry a reason code (why THAT product)", () => {
    expect(validateOutcome(candidate({
      outcomeType: "converted",
      productId: "1f2b1e5e-0000-4000-8000-000000000001",
      reasonCode: { code: "better_rate", active: true, appliesTo: ["converted"] },
    }))).toEqual([]);
  });
});

describe("validateOutcome — catalogue rules", () => {
  it("a retired code cannot be used for a new outcome", () => {
    expect(codes(validateOutcome(candidate({
      reasonCode: { code: "legacy_code", active: false, appliesTo: [] },
    })))).toEqual([VIOLATIONS.reasonCodeInactive]);
  });

  it("a code scoped to other outcome types is refused", () => {
    expect(codes(validateOutcome(candidate({
      outcomeType: "deferred",
      followUpNextActionId: "1f2b1e5e-0000-4000-8000-000000000002",
      reasonCode: { code: "moved_to_other_provider", active: true, appliesTo: ["declined"] },
    })))).toEqual([VIOLATIONS.reasonCodeNotApplicable]);
  });

  it("reports EVERY violation at once, so one round trip fixes the form", () => {
    // Retired AND out of scope AND (declined with no follow-up is fine) AND money broken.
    const violations = validateOutcome(candidate({
      outcomeType: "declined",
      reasonCode: { code: "legacy_code", active: false, appliesTo: ["converted"] },
      amountMinor: "-5",
      currency: null,
    }));
    expect(codes(violations)).toEqual([
      VIOLATIONS.amountInvalid,
      VIOLATIONS.currencyRequired,
      VIOLATIONS.reasonCodeInactive,
      VIOLATIONS.reasonCodeNotApplicable,
    ].sort());
  });

  it("names the offending field so a form can highlight it", () => {
    const [violation] = validateOutcome(candidate({ reasonCode: null }));
    expect(violation?.field).toBe("reasonCodeId");
  });
});

describe("validateOutcome — money rules", () => {
  const withMoney = (amountMinor: string | null, currency: string | null): OutcomeCandidate =>
    candidate({
      outcomeType: "converted",
      reasonCode: null,
      productId: "1f2b1e5e-0000-4000-8000-000000000001",
      amountMinor,
      currency,
    });

  it("accepts an amount with a currency, including one above 2^53", () => {
    expect(validateOutcome(withMoney("250000", "INR"))).toEqual([]);
    expect(validateOutcome(withMoney(ABOVE_2_53.toString(), "INR"))).toEqual([]);
  });

  it("accepts an outcome with no money at all (a conversion of unknown value)", () => {
    expect(validateOutcome(withMoney(null, null))).toEqual([]);
  });

  it("refuses an amount with no currency — it cannot be added up", () => {
    expect(codes(validateOutcome(withMoney("250000", null))))
      .toEqual([VIOLATIONS.currencyRequired]);
  });

  it("refuses a currency with no amount", () => {
    expect(codes(validateOutcome(withMoney(null, "INR"))))
      .toEqual([VIOLATIONS.amountRequired]);
  });

  it("refuses a non-integer, negative or exponent amount", () => {
    for (const bad of ["1.5", "-1", "1e3"]) {
      expect(codes(validateOutcome(withMoney(bad, "INR"))), `amount ${bad}`)
        .toEqual([VIOLATIONS.amountInvalid]);
    }
  });
});

describe("nextVersionNumber", () => {
  it("a code new to the tenant starts at revision 1", () => {
    expect(nextVersionNumber(0)).toBe(1);
  });

  it("re-declaring a code issues the next revision rather than editing history", () => {
    expect(nextVersionNumber(1)).toBe(2);
    expect(nextVersionNumber(7)).toBe(8);
  });
});

describe("the outcome vocabulary stays product-agnostic", () => {
  it("is exactly the three generic types — no postal concepts in code", () => {
    expect([...OUTCOME_TYPES]).toEqual(["converted", "declined", "deferred"]);
  });

  it("has no domain-specific member (reinvested / maturity / scheme names)", () => {
    const banned = ["reinvest", "maturity", "matured", "posb", "scss", "rpli", "withdraw"];
    for (const t of OUTCOME_TYPES as readonly OutcomeType[]) {
      for (const word of banned) {
        expect(t.toLowerCase()).not.toContain(word);
      }
    }
  });
});
