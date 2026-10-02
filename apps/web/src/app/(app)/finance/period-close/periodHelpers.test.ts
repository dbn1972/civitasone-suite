import { describe, it, expect } from "vitest";
import { formatClosedBy, periodBounds, shiftMonth, suggestPeriod, validatePeriod } from "./periodHelpers";

const TODAY = "2026-07-04";

describe("validatePeriod (GAP-FINANCE-PERIOD-CLOSE-03)", () => {
  it("accepts a plausible month", () => {
    expect(validatePeriod("2026-04", TODAY)).toBeNull();
    expect(validatePeriod("2027-07", TODAY)).toBeNull();
  });
  it("rejects a malformed month", () => {
    expect(validatePeriod("2026-13", TODAY)).toMatch(/valid month/);
    expect(validatePeriod("26-04", TODAY)).toMatch(/valid month/);
  });
  it("rejects the 2062-04 typo and an implausibly old month", () => {
    expect(validatePeriod("2062-04", TODAY)).toMatch(/months ahead/);
    expect(validatePeriod("2020-04", TODAY)).toMatch(/months back/);
  });
});

describe("shiftMonth / periodBounds", () => {
  it("crosses year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("bounds are current month -24 .. +12", () => {
    expect(periodBounds(TODAY)).toEqual({ min: "2024-07", max: "2027-07" });
  });
});

describe("suggestPeriod", () => {
  it("prefers the earliest still-open tracked period", () => {
    expect(
      suggestPeriod(
        [
          { period: "2026-06", status: "open" },
          { period: "2026-05", status: "open" },
          { period: "2026-04", status: "hard_close" },
        ],
        TODAY,
      ),
    ).toBe("2026-05");
  });
  it("otherwise suggests the month after the latest closed period", () => {
    expect(suggestPeriod([{ period: "2026-04", status: "soft_close" }, { period: "2026-05", status: "hard_close" }], TODAY)).toBe("2026-06");
  });
  it("suggests nothing when there is no history or the candidate is out of range", () => {
    expect(suggestPeriod([], TODAY)).toBe("");
    expect(suggestPeriod([{ period: "2020-01", status: "open" }], TODAY)).toBe("");
  });
});

describe("formatClosedBy (GAP-FINANCE-PERIOD-CLOSE-06)", () => {
  it("shortens a user id and keeps the full id as the title", () => {
    expect(formatClosedBy("11111111-1111-1111-1111-111111111111")).toEqual({
      text: "User 11111111",
      title: "11111111-1111-1111-1111-111111111111",
    });
  });
  it("keeps a real name and dashes a missing value", () => {
    expect(formatClosedBy("A. Verma")).toEqual({ text: "A. Verma" });
    expect(formatClosedBy(null)).toEqual({ text: "—" });
  });
});
