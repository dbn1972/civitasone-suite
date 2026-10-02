import { describe, it, expect } from "vitest";
import { VOUCHER_TYPES, isValidFrequency, isValidVoucherType, validateRunDates } from "./recurringForm";

describe("recurringForm", () => {
  it("voucher types are a closed set with journal first (default)", () => {
    expect(VOUCHER_TYPES[0].value).toBe("journal");
    expect(isValidVoucherType("journal")).toBe(true);
    expect(isValidVoucherType("jornal")).toBe(false);
    expect(isValidVoucherType("")).toBe(false);
  });
  it("frequency is a closed set", () => {
    expect(isValidFrequency("monthly")).toBe(true);
    expect(isValidFrequency("fortnightly")).toBe(false);
  });
  // GAP-FINANCE-RECURRING-ENTRIES-06
  it("rejects a past next-run date and an end date before it", () => {
    expect(validateRunDates("2026-10-02", "", "2026-10-03")).toEqual({ nextRunDate: "Next run date cannot be in the past." });
    expect(validateRunDates("2026-11-01", "2026-10-15", "2026-10-03")).toEqual({ endDate: "End date cannot be before the next run date." });
  });
  it("accepts today, a future date and an end on/after the next run", () => {
    expect(validateRunDates("2026-10-03", "", "2026-10-03")).toEqual({});
    expect(validateRunDates("2026-11-01", "2026-11-01", "2026-10-03")).toEqual({});
  });
  it("requires a next-run date", () => {
    expect(validateRunDates("", "", "2026-10-03")).toEqual({ nextRunDate: "Next run date is required." });
  });
});
