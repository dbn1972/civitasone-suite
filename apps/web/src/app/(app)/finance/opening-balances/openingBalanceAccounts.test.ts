import { describe, it, expect } from "vitest";
import {
  accountLabel,
  checkAccountCode,
  fiscalYearOptionLabel,
  fyAllowsOpeningBalances,
} from "./openingBalanceAccounts";

const COA = [
  { code: "1000", name: "Cash in hand", status: "active" as const },
  { code: "9999", name: "Retired head", status: "inactive" as const },
];

describe("checkAccountCode (GAP-FINANCE-OPENING-BALANCES-03)", () => {
  it("accepts a known active code", () => expect(checkAccountCode(" 1000 ", COA)).toBeNull());
  it("rejects an unknown code with an inline message", () =>
    expect(checkAccountCode("1O00", COA)).toMatch(/not in the chart of accounts/));
  it("rejects an inactive account", () => expect(checkAccountCode("9999", COA)).toMatch(/inactive/));
  it("lets everything through when the chart is unavailable (server stays the validator)", () => {
    expect(checkAccountCode("anything", undefined)).toBeNull();
    expect(checkAccountCode("anything", [])).toBeNull();
  });
});

describe("accountLabel", () => {
  it("shows code and name, or the bare code when unknown", () => {
    expect(accountLabel("1000", COA)).toBe("1000 — Cash in hand");
    expect(accountLabel("4242", COA)).toBe("4242");
    expect(accountLabel("1000", undefined)).toBe("1000");
  });
});

describe("fiscal-year status rules (GAP-FINANCE-OPENING-BALANCES-06)", () => {
  it("blocks closed years only (active|closed|draft are the real statuses)", () => {
    expect(fyAllowsOpeningBalances("closed")).toBe(false);
    expect(fyAllowsOpeningBalances("Closed")).toBe(false);
    expect(fyAllowsOpeningBalances("locked")).toBe(true);
    expect(fyAllowsOpeningBalances("active")).toBe(true);
    expect(fyAllowsOpeningBalances("draft")).toBe(true);
    expect(fyAllowsOpeningBalances("unknown")).toBe(true);
  });
  it("labels the status on every option", () => {
    expect(fiscalYearOptionLabel({ code: "2026-27", label: "FY 2026-27", status: "active" })).toBe("FY 2026-27 (2026-27) — active");
    expect(fiscalYearOptionLabel({ code: "2024-25", label: "FY 2024-25", status: "closed" })).toBe("FY 2024-25 (2024-25) — closed");
    expect(fiscalYearOptionLabel({ code: "x", label: "X", status: "unknown" })).toBe("X (x)");
  });
});
