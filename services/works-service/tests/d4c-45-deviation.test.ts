/**
 * Owner decision D4c #45 (GAP-WORKS-TENDERS-DETAIL-08): deviation % = (quoted - estimate) / estimate x 100, signed,
 * computed by the server. Pure rule here; the route + DB behaviour are in the sibling files.
 */
import { describe, it, expect } from "vitest";
import { deviationPercent, quotationDeviation } from "../src/modules/tender/domain.js";

describe("deviationPercent", () => {
  it("is (quoted - estimate) / estimate x 100, signed, two decimals", () => {
    expect(deviationPercent(11200n, 10000n)).toBe("12.00");
    expect(deviationPercent(9675n, 10000n)).toBe("-3.25");
    expect(deviationPercent(10000n, 10000n)).toBe("0.00");
    expect(deviationPercent(20000n, 10000n)).toBe("100.00");
    expect(deviationPercent(0n, 10000n)).toBe("-100.00");
  });
  it("rounds half away from zero at the second decimal", () => {
    expect(deviationPercent(10001n, 10000n)).toBe("0.01");
    expect(deviationPercent(10005n, 100000n)).toBe("-90.00"); // -89.995 -> away from zero
    expect(deviationPercent(1n, 3n)).toBe("-66.67");
    expect(deviationPercent(2n, 3n)).toBe("-33.33");
    expect(deviationPercent(4n, 3n)).toBe("33.33");
  });
  it("stays exact for amounts above 2^53 paise", () => {
    const est = 900700000000000000n;
    expect(deviationPercent(est + est / 10n, est)).toBe("10.00");
  });
  it("is null without a usable estimate (zero or negative)", () => {
    expect(deviationPercent(5n, 0n)).toBeNull();
    expect(deviationPercent(5n, -1n)).toBeNull();
  });
});

describe("quotationDeviation", () => {
  const base = { aboveOrBelowOrAtPar: null as string | null, quotedPercentage: null as string | null };
  it("uses the quoted amount against the estimate for an amount quotation", () => {
    expect(quotationDeviation({ ...base, method: "item_rate", quotedAmountMinor: 11200n }, 10000n)).toBe("12.00");
  });
  it("uses the signed quoted percentage for a percentage-rate quotation", () => {
    expect(quotationDeviation({ ...base, method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "12", aboveOrBelowOrAtPar: "above" }, 10000n)).toBe("12.00");
    expect(quotationDeviation({ ...base, method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "3.5", aboveOrBelowOrAtPar: "below" }, 10000n)).toBe("-3.50");
    expect(quotationDeviation({ ...base, method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "0", aboveOrBelowOrAtPar: "at_par" }, 10000n)).toBe("0.00");
  });
  it("percentage-rate needs no estimate (the percentage is already against it)", () => {
    expect(quotationDeviation({ ...base, method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "5", aboveOrBelowOrAtPar: "above" }, null)).toBe("5.00");
  });
  it("is null when the figures cannot support a number", () => {
    expect(quotationDeviation({ ...base, method: "item_rate", quotedAmountMinor: null }, 10000n)).toBeNull();
    expect(quotationDeviation({ ...base, method: "item_rate", quotedAmountMinor: 5n }, null)).toBeNull();
    expect(quotationDeviation({ ...base, method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "abc", aboveOrBelowOrAtPar: "above" }, 10000n)).toBeNull();
    expect(quotationDeviation({ ...base, method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "5", aboveOrBelowOrAtPar: null }, 10000n)).toBeNull();
  });
});
