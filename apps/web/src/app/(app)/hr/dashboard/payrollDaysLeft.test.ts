import { describe, it, expect } from "vitest";
import { payrollDaysLeft } from "./payrollDaysLeft";

// CLOS2-S2-04: days-left-in-month must follow the IST calendar, not the host clock.
describe("payrollDaysLeft (IST)", () => {
  it("is 0 at 01:00 IST on the last day of the month", () => {
    expect(payrollDaysLeft(new Date("2026-10-31T01:00:00+05:30"))).toBe(0);
  });
  it("is 1 at 23:00 IST the day before", () => {
    expect(payrollDaysLeft(new Date("2026-10-30T23:00:00+05:30"))).toBe(1);
  });
  it("handles February in a leap year", () => {
    expect(payrollDaysLeft(new Date("2028-02-28T10:00:00+05:30"))).toBe(1);
  });
});
