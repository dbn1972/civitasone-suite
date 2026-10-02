import { describe, it, expect } from "vitest";
import { computeGlStats, journalIdOf } from "./glStats";

describe("computeGlStats (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01)", () => {
  it("an empty ledger has no balance verdict", () => {
    expect(computeGlStats([]).balance).toBeNull();
  });
  it("sums BigInt paise exactly and compares debit with credit", () => {
    const s = computeGlStats([
      { id: "j1:x", accountCode: "1000", debit: "10", credit: "0" },
      { id: "j1:x", accountCode: "1000", debit: "20", credit: "0" },
      { id: "j1:x", accountCode: "2000", debit: "0", credit: "30" },
    ]);
    expect(s.totalDebit).toBe(30n);
    expect(s.totalCredit).toBe(30n);
    expect(s.accountsActive).toBe(2);
    expect(s.balance).toBe("balanced");
    expect(computeGlStats([{ id: "j1:x", accountCode: "1", debit: "5", credit: "0" }]).balance).toBe("unbalanced");
  });
});

describe("voucher vs line counts (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-02)", () => {
  it("2 vouchers x 3 lines => Vouchers 2, lines 6", () => {
    const rows = ["A", "B"].flatMap((j) =>
      [1, 2, 3].map((n) => ({ id: `${j}:${n}`, accountCode: `10${n}`, debit: n === 1 ? "30" : "0", credit: n === 1 ? "0" : "15" })),
    );
    const s = computeGlStats(rows);
    expect(s.vouchers).toBe(2);
    expect(s.entryLines).toBe(6);
    expect(s.accountsActive).toBe(3);
  });
  it("journalIdOf handles bare ids", () => {
    expect(journalIdOf("abc:2")).toBe("abc");
    expect(journalIdOf("abc")).toBe("abc");
  });
});
