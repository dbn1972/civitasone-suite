import { describe, it, expect } from "vitest";
import { billTotals, bankLine, minorOf } from "./vendorBills";

describe("billTotals (GAP-FINANCE-VENDORS-DETAIL-03 / -06)", () => {
  it("Total Paid counts paid bills only; Total Billed counts all", () => {
    const t = billTotals([
      { status: "paid", amount: "1000", tds: "100" },
      { status: "pending", amount: "500", tds: "50" },
      { status: "rejected", amount: "200", tds: "0" },
    ]);
    expect(t.paidMinor).toBe(1000n);
    expect(t.billedMinor).toBe(1700n);
    expect(t.tdsOnPaidMinor).toBe(100n);
  });

  it("a vendor with only pending bills has no paid figure (not the pending sum)", () => {
    const t = billTotals([{ status: "pending", amount: "500", tds: "5" }]);
    expect(t.paidMinor).toBeUndefined();
    expect(t.tdsOnPaidMinor).toBeUndefined();
    expect(t.billedMinor).toBe(500n);
  });

  it("is exact above 2^53 paise", () => {
    const t = billTotals([
      { status: "paid", amount: "9007199254740993" },
      { status: "paid", amount: "1" },
    ]);
    expect(t.paidMinor).toBe(9007199254740994n);
  });

  it("reads status case/separator-insensitively", () => {
    expect(billTotals([{ status: " PAID ", amount: "5" }]).paidMinor).toBe(5n);
  });

  it("minorOf accepts bigint / integer number / integer string and rejects the rest", () => {
    expect(minorOf({ a: 5n }, "a")).toBe(5n);
    expect(minorOf({ a: 5 }, "a")).toBe(5n);
    expect(minorOf({ a: "12" }, "a")).toBe(12n);
    expect(minorOf({ a: "1.5" }, "a")).toBeUndefined();
    expect(minorOf({ a: "" }, "a")).toBeUndefined();
  });
});

describe("bankLine (GAP-FINANCE-VENDORS-DETAIL-05)", () => {
  it("never prints '— (—)'", () => {
    expect(bankLine("—", "—")).toBe("—");
    expect(bankLine("SBI", "—")).toBe("SBI");
    expect(bankLine("—", "SBIN0001234")).toBe("SBIN0001234");
    expect(bankLine("SBI", "SBIN0001234")).toBe("SBI (SBIN0001234)");
  });
});
