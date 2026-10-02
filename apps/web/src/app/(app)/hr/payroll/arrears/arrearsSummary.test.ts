import { describe, it, expect } from "vitest";
import { summarizeArrears } from "./arrearsSummary";

describe("summarizeArrears (GAP-PAYROLL-ARREARS-02)", () => {
  it("counts only pending/approved rows as outstanding; rejected and paid are excluded", () => {
    const s = summarizeArrears([
      { status: "approved", difference_minor: 1000 },
      { status: "rejected", difference_minor: 500 },
      { status: "pending", difference_minor: -200 },
      { status: "paid", difference_minor: "700" },
    ]);
    expect(s.outstandingNetMinor).toBe(800n);
    expect(s.recoveriesMinor).toBe(-200n);
    expect(s.paidMinor).toBe(700n);
  });

  it("sums as bigint beyond 2^53 paise without float drift", () => {
    const s = summarizeArrears([
      { status: "pending", difference_minor: "9007199254740993" },
      { status: "approved", difference_minor: "1" },
    ]);
    expect(s.outstandingNetMinor).toBe(9007199254740994n);
  });

  it("tolerates null / garbage amounts as zero", () => {
    expect(summarizeArrears([{ status: "pending", difference_minor: null }, { status: "pending", difference_minor: "abc" }]).outstandingNetMinor).toBe(0n);
  });
});
