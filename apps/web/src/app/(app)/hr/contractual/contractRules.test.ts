import { describe, expect, it } from "vitest";
import { canRenew, canTerminate, validateNewEndDate } from "./contractRules";

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
