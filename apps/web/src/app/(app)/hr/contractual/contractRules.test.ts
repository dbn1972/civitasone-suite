import { describe, expect, it } from "vitest";
import { EXPIRING_SOON_STATUS, canRenew, canTerminate, contractDisplayStatus, isExpiringSoon, validateNewEndDate } from "./contractRules";

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

describe("expiry rules (GAP-HR-WORKFORCE-CONTRACTUAL-01)", () => {
  it("isExpiringSoon: live contract ending today..30d only", () => {
    expect(isExpiringSoon("active", 10)).toBe(true);
    expect(isExpiringSoon("expiring", 0)).toBe(true);
    expect(isExpiringSoon("active", 30)).toBe(true);
    expect(isExpiringSoon("active", 31)).toBe(false);
    expect(isExpiringSoon("expiring", 60)).toBe(false); // the backend flags expiring at <=90d
    expect(isExpiringSoon("expiring", -1)).toBe(false); // ended
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
    expect(contractDisplayStatus("terminated", -5)).toBe("terminated");
    expect(contractDisplayStatus("renewed", -5)).toBe("renewed");
    expect(contractDisplayStatus("active", null)).toBe("active");
  });
});
