import { describe, it, expect } from "vitest";
import { financialYearStartYear, fyQuarters, fyWhole, resolvePeriod } from "./period";

describe("forecast period helpers (GAP-CRM-FORECAST-03)", () => {
  it("maps calendar dates to the Indian financial year (Apr–Mar)", () => {
    expect(financialYearStartYear(new Date(Date.UTC(2026, 3, 1)))).toBe(2026); // Apr 2026
    expect(financialYearStartYear(new Date(Date.UTC(2026, 2, 31)))).toBe(2025); // Mar 2026 -> FY2025
    expect(financialYearStartYear(new Date(Date.UTC(2026, 0, 15)))).toBe(2025); // Jan 2026 -> FY2025
  });

  it("resolves FY quarters to inclusive close-date windows", () => {
    const [q1, q2, q3, q4] = fyQuarters(2026);
    expect(q1).toMatchObject({ closeDateFrom: "2026-04-01", closeDateTo: "2026-06-30" });
    expect(q2).toMatchObject({ closeDateFrom: "2026-07-01", closeDateTo: "2026-09-30" });
    expect(q3).toMatchObject({ closeDateFrom: "2026-10-01", closeDateTo: "2026-12-31" });
    expect(q4).toMatchObject({ closeDateFrom: "2027-01-01", closeDateTo: "2027-03-31" });
  });

  it("resolves a whole FY window", () => {
    expect(fyWhole(2026)).toMatchObject({ closeDateFrom: "2026-04-01", closeDateTo: "2027-03-31" });
  });

  it("resolvePeriod finds a known key and rejects an unknown one", () => {
    const now = new Date(Date.UTC(2026, 9, 5)); // Oct 2026 -> FY2026 is current
    expect(resolvePeriod("fy2026-q2", now)).toMatchObject({ closeDateFrom: "2026-07-01", closeDateTo: "2026-09-30" });
    expect(resolvePeriod("not-a-period", now)).toBeNull();
    expect(resolvePeriod(undefined, now)).toBeNull();
  });
});
