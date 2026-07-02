/**
 * Coverage tests for budget/domain.ts + shared/pfms.ts + shared/hoa.ts.
 * Pure domain logic — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import {
  DomainError,
  availableBalance,
  assertBudgetNotExceeded,
  sanctionAvailable,
  assertSanctionNotExhausted,
  assertValidFY,
  assertReleaseWithinSanction,
  assertReappropriationValid,
  assertSanctionApproverDistinct,
  assertValidPfmsHoA,
  assertValidDdoCode,
} from "../src/modules/budget/domain.js";
import { parseHoA, validateHoA, majorHeadOf, HoaError, HOA_TOTAL_WIDTH } from "../src/shared/hoa.js";
import { assertValidAgencyCode, assertValidSchemeCode, PfmsValidationError } from "../src/shared/pfms.js";

describe("budget/domain — availableBalance()", () => {
  it("returns RE minus utilised", () => {
    expect(availableBalance({ reMinor: 1000000n, utilisedMinor: 400000n })).toBe(600000n);
  });

  it("returns zero when fully utilised", () => {
    expect(availableBalance({ reMinor: 1000000n, utilisedMinor: 1000000n })).toBe(0n);
  });

  it("returns negative when over-utilised", () => {
    expect(availableBalance({ reMinor: 1000000n, utilisedMinor: 1200000n })).toBe(-200000n);
  });
});

describe("budget/domain — assertBudgetNotExceeded()", () => {
  it("passes when within budget", () => {
    expect(() => assertBudgetNotExceeded(500000n, 300000n)).not.toThrow();
  });

  it("passes when exactly at budget", () => {
    expect(() => assertBudgetNotExceeded(500000n, 500000n)).not.toThrow();
  });

  it("throws BUDGET_EXCEEDED when over budget", () => {
    expect(() => assertBudgetNotExceeded(500000n, 600000n)).toThrow(DomainError);
    try { assertBudgetNotExceeded(500000n, 600000n); } catch (e) {
      expect((e as DomainError).code).toBe("BUDGET_EXCEEDED");
    }
  });
});

describe("budget/domain — sanctions", () => {
  it("sanctionAvailable returns unspent", () => {
    expect(sanctionAvailable({ amountMinor: 1000000n, utilisedMinor: 300000n })).toBe(700000n);
  });

  it("assertSanctionNotExhausted passes within limit", () => {
    expect(() => assertSanctionNotExhausted({ amountMinor: 1000000n, utilisedMinor: 300000n }, 500000n)).not.toThrow();
  });

  it("assertSanctionNotExhausted throws when exhausted", () => {
    expect(() => assertSanctionNotExhausted({ amountMinor: 1000000n, utilisedMinor: 800000n }, 300000n)).toThrow();
    try { assertSanctionNotExhausted({ amountMinor: 1000000n, utilisedMinor: 800000n }, 300000n); } catch (e) {
      expect((e as DomainError).code).toBe("SANCTION_EXHAUSTED");
    }
  });
});

describe("budget/domain — assertValidFY()", () => {
  it("accepts valid FY format", () => {
    expect(() => assertValidFY("2024-25")).not.toThrow();
    expect(() => assertValidFY("2025-26")).not.toThrow();
  });

  it("rejects invalid FY format", () => {
    expect(() => assertValidFY("2024")).toThrow();
    expect(() => assertValidFY("2024-2025")).toThrow();
    expect(() => assertValidFY("24-25")).toThrow();
    try { assertValidFY("bad"); } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_FY");
    }
  });
});

describe("budget/domain — GFR Rules", () => {
  it("assertReleaseWithinSanction passes when RE <= BE", () => {
    expect(() => assertReleaseWithinSanction(1000000n, 800000n)).not.toThrow();
    expect(() => assertReleaseWithinSanction(1000000n, 1000000n)).not.toThrow();
  });

  it("assertReleaseWithinSanction throws when RE > BE (Rule 11)", () => {
    expect(() => assertReleaseWithinSanction(1000000n, 1100000n)).toThrow();
    try { assertReleaseWithinSanction(1000000n, 1100000n); } catch (e) {
      expect((e as DomainError).code).toBe("GFR_RULE_11_VIOLATION");
    }
  });

  it("assertReappropriationValid passes with sufficient savings", () => {
    expect(() => assertReappropriationValid({ reMinor: 1000000n, utilisedMinor: 300000n }, 500000n)).not.toThrow();
  });

  it("assertReappropriationValid throws for zero/negative amount", () => {
    expect(() => assertReappropriationValid({ reMinor: 1000000n, utilisedMinor: 0n }, 0n)).toThrow();
    try { assertReappropriationValid({ reMinor: 100n, utilisedMinor: 0n }, -1n); } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_AMOUNT");
    }
  });

  it("assertReappropriationValid throws when exceeds savings (Rule 10)", () => {
    expect(() => assertReappropriationValid({ reMinor: 1000000n, utilisedMinor: 800000n }, 300000n)).toThrow();
    try { assertReappropriationValid({ reMinor: 1000000n, utilisedMinor: 800000n }, 300000n); } catch (e) {
      expect((e as DomainError).code).toBe("INSUFFICIENT_SAVINGS");
    }
  });
});

describe("budget/domain — assertSanctionApproverDistinct()", () => {
  it("passes for different actors", () => {
    expect(() => assertSanctionApproverDistinct("user-a", "user-b")).not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION for same actor", () => {
    expect(() => assertSanctionApproverDistinct("user-a", "user-a")).toThrow();
    try { assertSanctionApproverDistinct("x", "x"); } catch (e) {
      expect((e as DomainError).code).toBe("MAKER_CHECKER_VIOLATION");
    }
  });
});

describe("shared/hoa — parseHoA()", () => {
  const VALID_HOA = "210100101010101000"; // 18 digits

  it("parses a valid 18-digit code", () => {
    const r = parseHoA(VALID_HOA);
    expect(r.majorHead).toBe("2101");
    expect(r.subMajorHead).toBe("00");
    expect(r.minorHead).toBe("101");
    expect(r.subHead).toBe("01");
    expect(r.detailedHead).toBe("01");
    expect(r.objectHead).toBe("01");
    expect(r.reserved).toBe("000");
  });

  it("throws HOA_EMPTY for null/undefined", () => {
    expect(() => parseHoA(null)).toThrow(HoaError);
    expect(() => parseHoA(undefined)).toThrow(HoaError);
  });

  it("throws HOA_BAD_LENGTH for wrong length", () => {
    expect(() => parseHoA("12345")).toThrow(HoaError);
    try { parseHoA("12345"); } catch (e) { expect((e as HoaError).code).toBe("HOA_BAD_LENGTH"); }
  });

  it("throws HOA_NON_NUMERIC for non-digits", () => {
    expect(() => parseHoA("21010010101010100A")).toThrow(HoaError);
    try { parseHoA("21010010101010100A"); } catch (e) { expect((e as HoaError).code).toBe("HOA_NON_NUMERIC"); }
  });
});

describe("shared/hoa — validateHoA()", () => {
  it("returns true for valid code", () => {
    expect(validateHoA("210100101010101000")).toBe(true);
  });

  it("returns false for invalid code", () => {
    expect(validateHoA("123")).toBe(false);
    expect(validateHoA(null)).toBe(false);
  });
});

describe("shared/hoa — majorHeadOf()", () => {
  it("returns first 4 digits", () => {
    expect(majorHeadOf("210100101010101000")).toBe("2101");
  });
});

describe("shared/pfms — assertValidPfmsHoA()", () => {
  it("passes for 18-digit code", () => {
    expect(() => assertValidPfmsHoA("210100101010101000")).not.toThrow();
  });

  it("throws for invalid code", () => {
    expect(() => assertValidPfmsHoA("12345")).toThrow(PfmsValidationError);
    expect(() => assertValidPfmsHoA(null)).toThrow();
  });
});

describe("shared/pfms — assertValidDdoCode()", () => {
  it("passes for valid DDO code (6-12 alphanumeric)", () => {
    expect(() => assertValidDdoCode("DDO001")).not.toThrow();
    expect(() => assertValidDdoCode("ABCDEF123456")).not.toThrow();
  });

  it("throws for too short", () => {
    expect(() => assertValidDdoCode("AB")).toThrow();
  });

  it("throws for null", () => {
    expect(() => assertValidDdoCode(null)).toThrow();
  });
});

describe("shared/pfms — assertValidAgencyCode()", () => {
  it("passes for valid agency code", () => {
    expect(() => assertValidAgencyCode("AGN001")).not.toThrow();
  });

  it("throws for invalid", () => {
    expect(() => assertValidAgencyCode("AB")).toThrow();
    expect(() => assertValidAgencyCode(null)).toThrow();
  });
});

describe("shared/pfms — assertValidSchemeCode()", () => {
  it("passes for valid scheme code (4-20 alphanumeric)", () => {
    expect(() => assertValidSchemeCode("SCHEME01")).not.toThrow();
  });

  it("throws for too short", () => {
    expect(() => assertValidSchemeCode("AB")).toThrow();
  });
});
