import { describe, it, expect } from "vitest";
import { computeGlStats } from "./glStats";

describe("computeGlStats (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01)", () => {
  it("an empty ledger has no balance verdict", () => {
    expect(computeGlStats([]).balance).toBeNull();
  });
  it("sums BigInt paise exactly and compares debit with credit", () => {
    const s = computeGlStats([
      { accountCode: "1000", debit: "10", credit: "0" },
      { accountCode: "1000", debit: "20", credit: "0" },
      { accountCode: "2000", debit: "0", credit: "30" },
    ]);
    expect(s.totalDebit).toBe(30n);
    expect(s.totalCredit).toBe(30n);
    expect(s.accountsActive).toBe(2);
    expect(s.balance).toBe("balanced");
    expect(computeGlStats([{ accountCode: "1", debit: "5", credit: "0" }]).balance).toBe("unbalanced");
  });
});
