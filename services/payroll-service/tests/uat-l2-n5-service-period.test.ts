/** UAT L2-N5: servicePeriodInMonth (pure). */
import { describe, it, expect } from "vitest";
import { servicePeriodInMonth } from "../src/modules/payroll/service-period.js";

describe("servicePeriodInMonth", () => {
  it("in service all month: joined before the period, not left", () => {
    expect(servicePeriodInMonth("2026-08", "2020-01-01")).toEqual({ inService: true, daysInMonth: 31, daysInService: 31, daysNotInService: 0 });
  });
  it("joined on the 1st: the whole month", () => {
    expect(servicePeriodInMonth("2026-08", "2026-08-01").daysInService).toBe(31);
  });
  it("joined AFTER the period end (UAT: DOJ 2026-10-28 in the Aug run): excluded", () => {
    expect(servicePeriodInMonth("2026-08", "2026-10-28")).toMatchObject({ inService: false, reason: "joined_after_period", daysInService: 0 });
    expect(servicePeriodInMonth("2026-08", "2026-09-01")).toMatchObject({ inService: false, reason: "joined_after_period" });
  });
  it("joined on the last day: one day in service", () => {
    expect(servicePeriodInMonth("2026-08", "2026-08-31")).toMatchObject({ inService: true, daysInService: 1, daysNotInService: 30 });
  });
  it("joined mid period: days from the joining date (inclusive)", () => {
    expect(servicePeriodInMonth("2026-08", "2026-08-22")).toMatchObject({ inService: true, daysInService: 10, daysNotInService: 21 });
    expect(servicePeriodInMonth("2026-02", "2026-02-15")).toMatchObject({ daysInMonth: 28, daysInService: 14 });
  });
  it("left BEFORE the period start: excluded", () => {
    expect(servicePeriodInMonth("2026-08", "2019-01-01", "2026-07-31")).toMatchObject({ inService: false, reason: "left_before_period" });
  });
  it("left mid period: days up to the date of leaving (inclusive)", () => {
    expect(servicePeriodInMonth("2026-08", "2019-01-01", "2026-08-10")).toMatchObject({ inService: true, daysInService: 10, daysNotInService: 21 });
    expect(servicePeriodInMonth("2026-08", "2019-01-01", "2026-08-01")).toMatchObject({ inService: true, daysInService: 1 });
  });
  it("left after the period: the whole month", () => {
    expect(servicePeriodInMonth("2026-08", "2019-01-01", "2026-09-30").daysInService).toBe(31);
  });
  it("joined and left inside the same period", () => {
    expect(servicePeriodInMonth("2026-08", "2026-08-05", "2026-08-14")).toMatchObject({ inService: true, daysInService: 10, daysNotInService: 21 });
  });
  it("left before joining (bad data) is never in service", () => {
    expect(servicePeriodInMonth("2026-08", "2026-08-20", "2026-08-10").inService).toBe(false);
  });
  it("missing / malformed dates keep the pre-L2-N5 behaviour (in service all month)", () => {
    expect(servicePeriodInMonth("2026-08", null).daysInService).toBe(31);
    expect(servicePeriodInMonth("2026-08", "", null).daysInService).toBe(31);
    expect(servicePeriodInMonth("2026-08", "not-a-date").daysInService).toBe(31);
  });
  it("a leap February", () => {
    expect(servicePeriodInMonth("2028-02", "2028-02-29")).toMatchObject({ daysInMonth: 29, daysInService: 1 });
  });
});
