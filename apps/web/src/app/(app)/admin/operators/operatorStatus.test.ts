import { describe, it, expect } from "vitest";
import { operatorAccountStatus, summariseOperators } from "./operatorStatus";

// GAP-ADMIN-OPERATORS-02
describe("operator account status", () => {
  it("an active operator whose 2FA is Disabled is Active, not Suspended", () => {
    const rows = [{ status: "active", twoFaStatus: "Disabled" }];
    expect(operatorAccountStatus(rows[0]!)).toBe("active");
    expect(summariseOperators(rows)).toEqual({ active: 1, suspended: 0, unknown: 0 });
  });
  it("a row with no status is Unknown, never inferred from 2FA", () => {
    const rows = [{ twoFaStatus: "Disabled" }, { status: "active" }];
    expect(operatorAccountStatus(rows[0]!)).toBe("unknown");
    expect(summariseOperators(rows)).toEqual({ active: 1, suspended: 0, unknown: 1 });
  });
  it("reports unknown (null) counts when no row carries a status at all", () => {
    expect(summariseOperators([{ twoFaStatus: "Enabled" }, { twoFaStatus: "Disabled" }])).toEqual({ active: null, suspended: null, unknown: 2 });
  });
  it("counts suspended-like statuses", () => {
    expect(summariseOperators([{ status: "suspended" }, { status: "disabled" }, { status: "active" }])).toEqual({ active: 1, suspended: 2, unknown: 0 });
  });
});
