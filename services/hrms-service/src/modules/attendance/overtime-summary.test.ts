import { describe, it, expect } from "vitest";
import { summariseOvertimeByStatus } from "./overtime-summary.js";

describe("summariseOvertimeByStatus (GAP-HR-OVERTIME-04)", () => {
  it("folds grouped status rows into the response summary", () => {
    expect(summariseOvertimeByStatus([
      { status: "pending", n: 120, hours: "300.00" },
      { status: "approved", n: "100", hours: "412.50" },
      { status: "rejected", n: 30, hours: "61.00" },
    ])).toEqual({ total: 250, pending: 120, approved: 100, rejected: 30, approvedHours: 412.5 });
  });

  it("only APPROVED hours are summed into approvedHours (pending and rejected hours are not payable)", () => {
    expect(summariseOvertimeByStatus([
      { status: "pending", n: 1, hours: "9.00" },
      { status: "approved", n: 1, hours: "2.25" },
      { status: "rejected", n: 1, hours: "7.00" },
    ]).approvedHours).toBe(2.25);
  });

  it("an empty scope is all zeros", () => {
    expect(summariseOvertimeByStatus([])).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0, approvedHours: 0 });
  });

  it("counts an unknown status in total only, and treats a null hours sum as zero", () => {
    expect(summariseOvertimeByStatus([
      { status: "cancelled", n: 2, hours: "5.00" },
      { status: "approved", n: 1, hours: null },
    ])).toEqual({ total: 3, pending: 0, approved: 1, rejected: 0, approvedHours: 0 });
  });

  it("rounds the approved-hours sum to hundredths (no float drift)", () => {
    expect(summariseOvertimeByStatus([{ status: "approved", n: 3, hours: "0.1000000001" }]).approvedHours).toBe(0.1);
  });
});
