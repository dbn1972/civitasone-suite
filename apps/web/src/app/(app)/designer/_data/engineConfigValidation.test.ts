import { describe, expect, it } from "vitest";
import {
  emptyEngineBindingConfig,
  parseDays,
  parsePercentToBps,
  validateEngineConfig,
} from "@/app/_components/ds/designer/engineBindingTypes";

/**
 * GAP-DESIGNER-DETAIL-ENGINES-02: validation reports out-of-range values with
 * an error instead of silently clamping/zeroing (which could zero a penalty
 * feeding tax computation).
 */
describe("parsePercentToBps (GAP-DESIGNER-DETAIL-ENGINES-02)", () => {
  it("parses valid percentages", () => {
    expect(parsePercentToBps("50")).toEqual({ ok: true, bps: 5000 });
    expect(parsePercentToBps("12.5")).toEqual({ ok: true, bps: 1250 });
    expect(parsePercentToBps("0")).toEqual({ ok: true, bps: 0 });
    expect(parsePercentToBps("100")).toEqual({ ok: true, bps: 10000 });
  });

  it("reports an error for over-100 instead of clamping", () => {
    const r = parsePercentToBps("150");
    expect(r.ok).toBe(false);
  });

  it("reports an error for negative instead of zeroing", () => {
    expect(parsePercentToBps("-5").ok).toBe(false);
  });

  it("reports an error for non-numeric", () => {
    expect(parsePercentToBps("abc").ok).toBe(false);
    expect(parsePercentToBps("").ok).toBe(false);
  });
});

describe("parseDays (GAP-DESIGNER-DETAIL-ENGINES-02)", () => {
  it("parses valid whole days", () => {
    expect(parseDays("30")).toEqual({ ok: true, days: 30 });
    expect(parseDays("0")).toEqual({ ok: true, days: 0 });
  });

  it("rejects negative and non-integer days", () => {
    expect(parseDays("-1").ok).toBe(false);
    expect(parseDays("1.5").ok).toBe(false);
    expect(parseDays("400").ok).toBe(false);
  });
});

describe("validateEngineConfig cross-field checks", () => {
  it("flags exemptions summing above 100%", () => {
    const config = {
      ...emptyEngineBindingConfig(),
      exemptionCategories: [
        { code: "A", label: "A", percentBps: 6000 },
        { code: "B", label: "B", percentBps: 5000 },
      ],
    };
    const errors = validateEngineConfig(config);
    expect(errors.some((e) => /100%/.test(e))).toBe(true);
  });

  it("passes a valid config", () => {
    const config = {
      ...emptyEngineBindingConfig(),
      penaltyPercentBps: 500,
      rebatePercentBps: 1000,
      rebateWindowDays: 30,
      penaltyGraceDays: 15,
    };
    expect(validateEngineConfig(config)).toEqual([]);
  });
});
