import { describe, it, expect } from "vitest";
import { formatDrCr, mapLedgerBalances, parseHeadParam } from "./ledgerBalances";

describe("ledger balances helpers (fx-p3)", () => {
  it("Dr / Cr comes from the sign (debit-positive); zero has no side", () => {
    expect(formatDrCr("150000")).toBe("₹1,500.00 Dr");
    expect(formatDrCr("-150000")).toBe("₹1,500.00 Cr");
    expect(formatDrCr("0")).toBe("₹0.00");
    expect(formatDrCr("-9007199254740993")).toBe("₹9,00,71,99,25,47,409.93 Cr");
  });

  it("maps the documented body and keeps paise exact", () => {
    const m = mapLedgerBalances({
      fiscalYear: "2026-27",
      head: { id: "u-1", code: "8443", name: "Civil Deposits", nature: "liability", carryForward: true },
      openingMinor: "-500000", closingMinor: "-650000",
      periods: [{ period: "2026-04", openingMinor: "-500000", debitMinor: "100000", creditMinor: "250000", closingMinor: "-650000" }],
    })!;
    expect(m.head.carryForward).toBe(true);
    expect(m.periods[0]).toEqual({ period: "2026-04", openingMinor: "-500000", debitMinor: "100000", creditMinor: "250000", closingMinor: "-650000" });
    expect(mapLedgerBalances({ fiscalYear: "2026-27" })).toBeNull();
    expect(mapLedgerBalances(null)).toBeNull();
  });

  it("accepts a head uuid or code from the URL and nothing else", () => {
    expect(parseHeadParam("11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    expect(parseHeadParam("8443")).toBe("8443");
    expect(parseHeadParam(" 2202.01 ")).toBe("2202.01");
    for (const bad of ["", "../x", "a b", "<script>", undefined, 5]) expect(parseHeadParam(bad)).toBeNull();
  });
});
