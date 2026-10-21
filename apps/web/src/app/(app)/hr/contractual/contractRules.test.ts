import { describe, expect, it } from "vitest";
import { EXPIRING_SOON_STATUS, canRenew, canTerminate, contractDisplayStatus, contractExpiryState, isExpiringSoon, validateNewEndDate } from "./contractRules";

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
  // The "Expiring <=30d" tile is an END-DATE test (GAP-HR-CONTRACTUAL-04 and GAP-HR-WORKFORCE-CONTRACTUAL-01 both: 0..30
  // days). The scheduler flags 'expiring' at <=90 days, so that flag alone must not put a 45-day contract in the tile.
  it("a scheduler-flagged 'expiring' contract is Expiring only within 30 days of its end, and Expired once past it", () => {
    expect(contractExpiryState("expiring", 10)).toBe("expiring");
    expect(contractExpiryState("expiring", 45)).toBe("active");
    expect(contractExpiryState("expiring", -3)).toBe("expired");
  });
  it("an escalated contract is classified by its end date like an active one", () => {
    expect(contractExpiryState("escalated", 10)).toBe("expiring");
    expect(contractExpiryState("escalated", 45)).toBe("active");
    expect(contractExpiryState("escalated", -1)).toBe("expired");
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

describe("expiry rules (GAP-HR-WORKFORCE-CONTRACTUAL-01)", () => {
  it("isExpiringSoon: live contract ending today..30d only", () => {
    expect(isExpiringSoon("active", 10)).toBe(true);
    expect(isExpiringSoon("expiring", 0)).toBe(true);
    expect(isExpiringSoon("active", 30)).toBe(true);
    expect(isExpiringSoon("active", 31)).toBe(false);
    expect(isExpiringSoon("expiring", 60)).toBe(false); // the backend flags expiring at <=90d
    expect(isExpiringSoon("expiring", -1)).toBe(false); // ended
    expect(isExpiringSoon("escalated", 10)).toBe(true); // in force, same end-date rule as the backend summary
    expect(isExpiringSoon("escalated", 31)).toBe(false);
    expect(isExpiringSoon("terminated", 5)).toBe(false);
    expect(isExpiringSoon("renewed", 5)).toBe(false);
    expect(isExpiringSoon("expired", 5)).toBe(false);
    expect(isExpiringSoon("active", null)).toBe(false);
    expect(isExpiringSoon("active", Number.NaN)).toBe(false);
  });
  it("contractDisplayStatus: highlights <=30d, sweeps an ended live contract to expired, passes the rest through", () => {
    expect(contractDisplayStatus("active", 10)).toBe(EXPIRING_SOON_STATUS);
    expect(contractDisplayStatus("expiring", 60)).toBe("expiring");
    expect(contractDisplayStatus("expiring", -1)).toBe("expired");
    expect(contractDisplayStatus("active", -1)).toBe("expired");
    expect(contractDisplayStatus("escalated", 10)).toBe("escalated"); // keeps its own pill; only the tile counts it
    expect(contractDisplayStatus("terminated", -5)).toBe("terminated");
    expect(contractDisplayStatus("renewed", -5)).toBe("renewed");
    expect(contractDisplayStatus("active", null)).toBe("active");
  });
});
