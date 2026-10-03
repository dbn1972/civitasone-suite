import { describe, it, expect } from "vitest";
import { formatCaseNo, istYear, istToday, countsFromStatusMap, canAssign, canDispose } from "../src/modules/grievance/domain.js";

describe("grievance domain", () => {
  it("formats GRV/YYYY/NNNN, zero-padded to 4 and growing past 9999", () => {
    expect(formatCaseNo(2026, 1)).toBe("GRV/2026/0001");
    expect(formatCaseNo(2026, 123)).toBe("GRV/2026/0123");
    expect(formatCaseNo(2026, 12345)).toBe("GRV/2026/12345");
  });

  it("takes the register year in IST, not UTC (31 Dec 20:00 UTC is already 1 Jan in India)", () => {
    expect(istYear(new Date("2026-12-31T20:00:00Z"))).toBe(2027);
    expect(istYear(new Date("2026-12-31T12:00:00Z"))).toBe(2026);
    expect(istToday(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });

  it("counts reconcile to total and count an unlisted status as open (nothing is dropped)", () => {
    const c = countsFromStatusMap({ registered: 2, under_inquiry: 3, disposed: 4, escalated: 1 });
    expect(c).toEqual({ total: 10, open: 3, underInquiry: 3, disposed: 4 });
    expect(c.open + c.underInquiry + c.disposed).toBe(c.total);
    expect(countsFromStatusMap({})).toEqual({ total: 0, open: 0, underInquiry: 0, disposed: 0 });
  });

  it("only open cases can be assigned or disposed", () => {
    expect(canAssign("registered")).toBe(true);
    expect(canAssign("under_inquiry")).toBe(true);
    expect(canAssign("disposed")).toBe(false);
    expect(canDispose("disposed")).toBe(false);
  });
});
