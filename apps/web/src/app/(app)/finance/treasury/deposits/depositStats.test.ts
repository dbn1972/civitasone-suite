import { describe, it, expect } from "vitest";
import { depositStats, depositStatusVariant, depositTypeLabel } from "./depositStats";

describe("depositStats (GAP-FINANCE-TREASURY-DEPOSITS-02 / -05)", () => {
  it("counts the three real statuses (active | refunded | forfeited) and they sum to the total", () => {
    const s = depositStats([
      { status: "active", balanceMinor: "100" },
      { status: "ACTIVE", balanceMinor: "250" },
      { status: "refunded", balanceMinor: "0" },
      { status: "forfeited", balanceMinor: "0" },
      { status: "forfeited", balanceMinor: "0" },
    ]);
    expect(s).toMatchObject({ total: 5, active: 2, refunded: 1, forfeited: 2 });
    expect(s.active + s.refunded + s.forfeited).toBe(s.total);
  });

  it("sums ACTIVE balances only, in exact paise (BigInt)", () => {
    expect(depositStats([
      { status: "active", balanceMinor: "100" },
      { status: "active", balanceMinor: "250" },
      { status: "refunded", balanceMinor: "1000" },
      { status: "active", balanceMinor: "abc" },
    ]).activeBalanceMinor).toBe(350n);
    expect(depositStats([{ status: "active", balanceMinor: "9007199254740993" }, { status: "active", balanceMinor: "1" }]).activeBalanceMinor)
      .toBe(9007199254740994n);
  });

  it("gives refunded and forfeited their own pill tones (table-local)", () => {
    expect(depositStatusVariant("active")).toBe("good");
    expect(depositStatusVariant("refunded")).toBe("mut");
    expect(depositStatusVariant("forfeited")).toBe("warn");
    expect(depositStatusVariant("whatever")).toBeUndefined();
  });

  it("names the deposit types the service accepts", () => {
    expect(depositTypeLabel("pd")).toBe("Personal Deposit (PD)");
    expect(depositTypeLabel("EMD")).toBe("Earnest Money (EMD)");
    expect(depositTypeLabel("zzz")).toBe("zzz");
  });
});
