import { describe, it, expect } from "vitest";
import { payScheduleFields, payScheduleProblem, describePayDay, weekdayName } from "./payGroupSchedule";

describe("payGroupSchedule (GAP-PAYROLL-PAY-GROUPS-01)", () => {
  it("monthly sends the day (and last-day flag) and clears weekday fields", () => {
    expect(payScheduleFields({ frequency: "monthly", dayOfMonth: 31, lastDay: true, weekday: 3, parity: 1 }))
      .toEqual({ frequency: "monthly", payDayOfMonth: 31, payLastDay: true, payWeekday: null, payWeekParity: null });
  });

  it("weekly sends the weekday and no day-of-month", () => {
    const f = payScheduleFields({ frequency: "weekly", dayOfMonth: 28, lastDay: true, weekday: 5, parity: 1 });
    expect(f).toEqual({ frequency: "weekly", payLastDay: false, payWeekday: 5, payWeekParity: null });
  });

  it("bi-weekly sends weekday and parity", () => {
    expect(payScheduleFields({ frequency: "bi_weekly", dayOfMonth: 28, lastDay: false, weekday: 1, parity: 0 }))
      .toEqual({ frequency: "bi_weekly", payLastDay: false, payWeekday: 1, payWeekParity: 0 });
  });

  it("flags what is missing for each frequency", () => {
    expect(payScheduleProblem({ frequency: "monthly", dayOfMonth: 32, lastDay: false, weekday: null, parity: null })).toBe("dayRangeError");
    expect(payScheduleProblem({ frequency: "monthly", dayOfMonth: NaN, lastDay: true, weekday: null, parity: null })).toBeNull();
    expect(payScheduleProblem({ frequency: "weekly", dayOfMonth: 1, lastDay: false, weekday: null, parity: null })).toBe("weekdayRequiredError");
    expect(payScheduleProblem({ frequency: "bi_weekly", dayOfMonth: 1, lastDay: false, weekday: 2, parity: null })).toBe("parityRequiredError");
    expect(payScheduleProblem({ frequency: "bi_weekly", dayOfMonth: 1, lastDay: false, weekday: 2, parity: 0 })).toBeNull();
  });

  it("names ISO weekdays in the locale", () => {
    expect(weekdayName(1, "en")).toBe("Monday");
    expect(weekdayName(7, "en")).toBe("Sunday");
  });

  it("describes the pay day by frequency, with a legacy fallback", () => {
    expect(describePayDay({ frequency: "monthly", payDayOfMonth: 5 })).toEqual({ kind: "dayOfMonth", day: 5 });
    expect(describePayDay({ frequency: "monthly", payDayOfMonth: 31, payLastDay: true })).toEqual({ kind: "lastDay" });
    expect(describePayDay({ frequency: "weekly", payDayOfMonth: 5, payWeekday: 5 })).toEqual({ kind: "weekday", weekday: 5 });
    expect(describePayDay({ frequency: "bi_weekly", payDayOfMonth: 5, payWeekday: 5, payWeekParity: 1 })).toEqual({ kind: "biWeekly", weekday: 5, parity: 1 });
    expect(describePayDay({ frequency: "weekly", payDayOfMonth: 5 })).toEqual({ kind: "legacyDay", day: 5 });
  });
});
