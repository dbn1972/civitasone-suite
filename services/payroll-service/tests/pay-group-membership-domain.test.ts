/** GAP-PAYROLL-PAY-GROUPS-03: pure membership rules. */
import { describe, it, expect } from "vitest";
import {
  planAssignment, effectiveDateProblem, groupForMonth, monthBounds, membershipStatus, isIsoDate, isFirstOfMonth, todayIst,
} from "../src/modules/payroll/pay-group-domain.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const span = (id: string, payGroupId: string, effectiveFrom: string, effectiveTo: string | null = null) => ({ id, payGroupId, effectiveFrom, effectiveTo });

describe("planAssignment", () => {
  it("first assignment is an insert", () => {
    expect(planAssignment([], A, "2026-10-01")).toEqual({ kind: "insert" });
  });
  it("same group on the covering assignment is a no-op", () => {
    expect(planAssignment([span("x", A, "2026-04-01")], A, "2026-10-01")).toEqual({ kind: "unchanged", code: "ALREADY_MEMBER" });
  });
  it("a different group closes the covering assignment (a move)", () => {
    expect(planAssignment([span("x", A, "2026-04-01")], B, "2026-10-01")).toEqual({ kind: "move", closeId: "x", fromPayGroupId: A });
  });
  it("refuses a date before an assignment that already exists", () => {
    const r = planAssignment([span("x", A, "2026-12-01")], B, "2026-10-01");
    expect(r).toMatchObject({ kind: "reject", code: "MEMBERSHIP_OVERLAP" });
  });
  it("refuses a move on the very day the current assignment starts", () => {
    expect(planAssignment([span("x", A, "2026-10-01")], B, "2026-10-01")).toMatchObject({ kind: "reject", code: "MEMBERSHIP_OVERLAP" });
  });
  it("an ended earlier assignment does not block a new one (history kept, no overlap)", () => {
    expect(planAssignment([span("x", A, "2026-04-01", "2026-08-01")], B, "2026-10-01")).toEqual({ kind: "insert" });
  });
  it("effectiveTo is exclusive: a new group may start on the day the old one ends", () => {
    expect(planAssignment([span("x", A, "2026-04-01", "2026-10-01")], B, "2026-10-01")).toEqual({ kind: "insert" });
  });
});

describe("effectiveDateProblem", () => {
  it("defaults to the 1st of a month", () => {
    expect(effectiveDateProblem("2026-10-01", false)).toBeNull();
    expect(effectiveDateProblem("2026-10-15", false)).toBe("EFFECTIVE_DATE_NOT_MONTH_START");
  });
  it("another date is allowed when the tenant allows it", () => {
    expect(effectiveDateProblem("2026-10-15", true)).toBeNull();
  });
  it("rejects impossible dates", () => {
    expect(effectiveDateProblem("2026-02-30", true)).toBe("INVALID_DATE");
    expect(effectiveDateProblem("nope", false)).toBe("INVALID_DATE");
  });
  it("date helpers", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isFirstOfMonth("2026-01-01")).toBe(true);
  });
});

describe("groupForMonth (which group pays an employee for a month)", () => {
  const move = [span("1", A, "2026-04-01", "2026-12-01"), span("2", B, "2026-12-01")];
  it("a move takes effect from the effective month", () => {
    expect(groupForMonth(move, "2026-11")).toBe(A);
    expect(groupForMonth(move, "2026-12")).toBe(B);
    expect(groupForMonth(move, "2027-03")).toBe(B);
  });
  it("a mid-month move is paid by the new group for that month", () => {
    const mid = [span("1", A, "2026-04-01", "2026-12-15"), span("2", B, "2026-12-15")];
    expect(groupForMonth(mid, "2026-12")).toBe(B);
    expect(groupForMonth(mid, "2026-11")).toBe(A);
  });
  it("an ended membership still pays its last month; nothing before the start or after the end", () => {
    const ended = [span("1", A, "2026-04-01", "2026-12-01")];
    expect(groupForMonth(ended, "2026-11")).toBe(A);
    expect(groupForMonth(ended, "2026-12")).toBeNull();
    expect(groupForMonth(ended, "2026-03")).toBeNull();
  });
});

describe("misc", () => {
  it("monthBounds rolls the year", () => {
    expect(monthBounds("2026-12")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
  });
  it("membershipStatus", () => {
    expect(membershipStatus("2026-10-01", null, "2026-09-30")).toBe("scheduled");
    expect(membershipStatus("2026-10-01", null, "2026-10-01")).toBe("current");
    expect(membershipStatus("2026-10-01", "2026-11-01", "2026-11-01")).toBe("ended");
  });
  it("todayIst is the calendar date in India", () => {
    expect(todayIst(new Date("2026-10-03T19:00:00Z"))).toBe("2026-10-04");
  });
});
