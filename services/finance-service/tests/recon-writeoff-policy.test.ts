/**
 * C30 / GAP-FINANCE-RECONCILIATION-01: write-off second approval (pure rule, no DB).
 */
import { describe, it, expect } from "vitest";
import {
  decideWriteOff, assertMayDeclineWriteOff, DEFAULT_WRITEOFF_SECOND_APPROVAL_MINOR, WRITEOFF_SECOND_APPROVER_ROLES,
} from "../src/modules/recon/writeoff-policy.js";

const T = 5_000_000n; // Rs 50,000
const MAKER = "11111111-1111-4111-8111-111111111111";
const APPROVER = "22222222-2222-4222-8222-222222222222";

describe("decideWriteOff", () => {
  it("the placeholder default is Rs 50,000 in paise and the approvers are finance_admin / super_admin", () => {
    expect(DEFAULT_WRITEOFF_SECOND_APPROVAL_MINOR).toBe(5_000_000n);
    expect([...WRITEOFF_SECOND_APPROVER_ROLES]).toEqual(["finance_admin", "super_admin"]);
  });
  it("is single-step at or below the threshold, either sign", () => {
    for (const d of [3_000n, 5_000_000n, -5_000_000n, null]) {
      expect(decideWriteOff({ deltaMinor: d, thresholdMinor: T, requestedBy: null, actorId: MAKER, actorRoles: ["finance_officer"] })).toBe("direct");
    }
  });
  it("files a request above the threshold (by absolute amount)", () => {
    for (const d of [5_000_001n, -4_500_000_000n]) {
      expect(decideWriteOff({ deltaMinor: d, thresholdMinor: T, requestedBy: null, actorId: MAKER, actorRoles: ["finance_officer"] })).toBe("request");
    }
  });
  it("threshold 0 sends every non-zero write-off for second approval", () => {
    expect(decideWriteOff({ deltaMinor: 1n, thresholdMinor: 0n, requestedBy: null, actorId: MAKER, actorRoles: ["finance_officer"] })).toBe("request");
  });
  it("a different finance_admin / super_admin completes a pending request", () => {
    for (const role of ["finance_admin", "super_admin"]) {
      expect(decideWriteOff({ deltaMinor: 9_000_000n, thresholdMinor: T, requestedBy: MAKER, actorId: APPROVER, actorRoles: [role] })).toBe("approve");
    }
  });
  it("the requester cannot approve their own request (MAKER_CHECKER_VIOLATION), even as finance_admin", () => {
    expect(() => decideWriteOff({ deltaMinor: 9_000_000n, thresholdMinor: T, requestedBy: MAKER, actorId: MAKER, actorRoles: ["finance_admin"] }))
      .toThrow(/MAKER_CHECKER_VIOLATION/);
  });
  it("a finance_officer cannot be the second approver", () => {
    expect(() => decideWriteOff({ deltaMinor: 9_000_000n, thresholdMinor: T, requestedBy: MAKER, actorId: APPROVER, actorRoles: ["finance_officer"] }))
      .toThrow(/WRITEOFF_APPROVER_ROLE_REQUIRED/);
  });
});

describe("assertMayDeclineWriteOff", () => {
  it("needs a pending request", () => {
    expect(() => assertMayDeclineWriteOff({ requestedBy: null, actorId: APPROVER, actorRoles: ["finance_admin"] })).toThrow(/NO_PENDING_WRITEOFF/);
  });
  it("the requester may withdraw; a finance_admin may decline; another finance_officer may not", () => {
    expect(() => assertMayDeclineWriteOff({ requestedBy: MAKER, actorId: MAKER, actorRoles: ["finance_officer"] })).not.toThrow();
    expect(() => assertMayDeclineWriteOff({ requestedBy: MAKER, actorId: APPROVER, actorRoles: ["finance_admin"] })).not.toThrow();
    expect(() => assertMayDeclineWriteOff({ requestedBy: MAKER, actorId: APPROVER, actorRoles: ["finance_officer"] })).toThrow(/WRITEOFF_APPROVER_ROLE_REQUIRED/);
  });
});
