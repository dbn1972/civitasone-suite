import { describe, it, expect } from "vitest";
import { mapBankAccounts, mapFiscalYears } from "./loaders";

describe("mapFiscalYears (GAP-FINANCE-CONFIG-05: one mapper for /finance/config and /finance/fiscal-years)", () => {
  const row = { id: "f1", code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" };
  it("accepts both a bare array and a {data} envelope", () => {
    expect(mapFiscalYears([row])).toEqual([row]);
    expect(mapFiscalYears({ data: [row] })).toEqual([row]);
  });
  it("defaults missing fields and skips rows without a code/label; null for a non-list payload", () => {
    expect(mapFiscalYears([{ code: "2027-28", label: "FY 2027-28" }, { nope: 1 }, "x"])).toEqual([
      { code: "2027-28", label: "FY 2027-28", startDate: "", endDate: "", status: "unknown" },
    ]);
    expect(mapFiscalYears({ error: "x" })).toBeNull();
  });
});

describe("mapBankAccounts", () => {
  it("keeps only the masked fields and accepts both payload shapes", () => {
    const b = { id: "b1", bankName: "SBI", branchName: null, accountNoLast4: "1234", ifscPrefix: "SBINXXXXXXX", accountType: "current", purpose: null, status: "active", accountNo: "999999999999" };
    const out = mapBankAccounts({ data: [b] });
    expect(out).toEqual([{ id: "b1", bankName: "SBI", branchName: null, accountNoLast4: "1234", ifscPrefix: "SBINXXXXXXX", accountType: "current", purpose: null, status: "active" }]);
    expect(mapBankAccounts([b])).toHaveLength(1);
    expect(mapBankAccounts("x")).toBeNull();
  });
});
