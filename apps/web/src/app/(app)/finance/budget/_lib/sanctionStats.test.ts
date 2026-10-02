import { describe, it, expect } from "vitest";
import { summariseSanctions } from "./sanctionStats";

// GAP-FINANCE-BUDGET-SANCTIONS-03
describe("summariseSanctions", () => {
  const rows = [
    { status: "approved", amount: "100" },
    { status: "pending", amount: "50" },
    { status: "rejected", amount: "25" },
  ];
  it("Sanctioned value is APPROVED money only; pending/rejected do not inflate it", () => {
    const s = summariseSanctions(rows);
    expect(s.approvedMinor).toBe(100n);
    expect(s.pendingMinor).toBe(50n);
  });
  it("Active excludes rejected sanctions", () => {
    const s = summariseSanctions(rows);
    expect(s).toMatchObject({ active: 2, approved: 1, pending: 1 });
  });
  // The API only ever emits approved|pending|rejected (finance-service maps its stored
  // approved/exhausted -> approved, cancelled/rejected -> rejected, draft/pending_approval
  // -> pending). A raw stored value must never be counted as approved money.
  it("counts only the contract's approved status as sanctioned; raw stored statuses are ignored", () => {
    const s = summariseSanctions([
      { status: "approved", amount: "100" },
      { status: "cancelled", amount: "7" },
      { status: "pending_approval", amount: "9" },
      { status: "exhausted", amount: "11" },
    ]);
    expect(s.approvedMinor).toBe(100n);
    expect(s.active).toBe(1);
  });
  it("sums above 2^53 exactly and ignores a malformed amount", () => {
    const s = summariseSanctions([{ status: "approved", amount: "9007199254740993" }, { status: "approved", amount: "oops" }]);
    expect(s.approvedMinor).toBe(9007199254740993n);
  });
});
