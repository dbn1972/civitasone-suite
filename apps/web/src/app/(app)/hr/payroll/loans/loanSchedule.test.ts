import { describe, it, expect } from "vitest";
import { mapLoanSchedule, pickScheduleLoan } from "./loanSchedule";

describe("loanSchedule (GAP-PAYROLL-LOANS-06)", () => {
  it("maps the API schedule array and drops malformed rows", () => {
    const rows = mapLoanSchedule({ loanId: "l1", schedule: [{ installmentNo: 1, openingMinor: 100, emiMinor: 10, principalMinor: 9, interestMinor: 1, closingMinor: 91 }, null, { foo: 1 }] });
    expect(rows).toHaveLength(1);
    expect(rows?.[0].installmentNo).toBe(1);
  });
  it("returns null (an error, not an empty schedule) for a malformed payload", () => {
    expect(mapLoanSchedule({})).toBeNull();
    expect(mapLoanSchedule(null)).toBeNull();
  });
  it("picks the requested loan only if it belongs to the employee, else the first live loan", () => {
    const loans = [{ id: "a", status: "applied" }, { id: "b", status: "active" }, { id: "c", status: "closed" }];
    expect(pickScheduleLoan(loans, "c")?.id).toBe("c");
    expect(pickScheduleLoan(loans, "someone-elses")?.id).toBe("b");
    expect(pickScheduleLoan([{ id: "a", status: "applied" }], undefined)?.id).toBe("a");
    expect(pickScheduleLoan([], "x")).toBeNull();
  });
});
