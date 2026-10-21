import { describe, expect, it } from "vitest";
import { canRenew, canTerminate, validateNewEndDate, contractExpiryState } from "./contractRules";

describe("contract action rules (GAP-HR-CONTRACTUAL-05)", () => {
  it("renew: active/expiring only, HR or manager", () => {
    expect(canRenew("active", ["manager"])).toBe(true);
    expect(canRenew("expiring", ["hr_admin"])).toBe(true);
    expect(canRenew("expired", ["hr_admin"])).toBe(false);
    expect(canRenew("active", ["employee"])).toBe(false);
  });
  it("terminate: active only, HR only (not manager)", () => {
    expect(canTerminate("active", ["hr_officer"])).toBe(true);
    expect(canTerminate("active", ["manager"])).toBe(false);
    expect(canTerminate("expiring", ["hr_admin"])).toBe(false);
  });
  it("new end date must be a valid date strictly after the current end", () => {
    expect(validateNewEndDate("", "2026-12-31")).toBe("required");
    expect(validateNewEndDate("31/12/2027", "2026-12-31")).toBe("invalid");
    expect(validateNewEndDate("2026-12-31", "2026-12-31")).toBe("notAfter");
    expect(validateNewEndDate("2027-06-30", "2026-12-31")).toBeNull();
  });
});

// GAP-HR-CONTRACTUAL-04: expiry classification from status AND end date (mirrors hrms-service summarizeContracts).
describe("contractExpiryState (GAP-HR-CONTRACTUAL-04)", () => {
  it("an active contract whose end date was yesterday is Expired, not Active", () => {
    expect(contractExpiryState("active", -1)).toBe("expired");
  });
  it("a contract ending in 10 days is Expiring", () => {
    expect(contractExpiryState("active", 10)).toBe("expiring");
  });
  it("ending today is still in force: Expiring (0 days), not Expired", () => {
    expect(contractExpiryState("active", 0)).toBe("expiring");
  });
  it("the 30-day window is inclusive; day 31 is plain Active", () => {
    expect(contractExpiryState("active", 30)).toBe("expiring");
    expect(contractExpiryState("active", 31)).toBe("active");
  });
  it("a scheduler-flagged 'expiring' contract is Expiring even beyond 30 days, but Expired once past its end", () => {
    expect(contractExpiryState("expiring", 45)).toBe("expiring");
    expect(contractExpiryState("expiring", -3)).toBe("expired");
  });
  it("status 'expired' is Expired whatever the date says", () => {
    expect(contractExpiryState("expired", 100)).toBe("expired");
    expect(contractExpiryState("expired", null)).toBe("expired");
  });
  it("terminated / renewed / draft are not classified, past their end date or not", () => {
    for (const status of ["terminated", "renewed", "draft"]) {
      expect(contractExpiryState(status, -10)).toBe("none");
      expect(contractExpiryState(status, 10)).toBe("none");
    }
  });
  it("an open contract with an unreadable end date is not classified (never counted as a number of days)", () => {
    expect(contractExpiryState("active", null)).toBe("none");
  });
});
