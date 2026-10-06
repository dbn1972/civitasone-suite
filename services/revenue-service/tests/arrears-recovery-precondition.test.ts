/**
 * GAP-REVENUE-RECOVERY-01 — a recovery referral may only be raised against an
 * assessee that actually has outstanding arrears (fail closed otherwise).
 */
import { describe, it, expect } from "vitest";
import { validateRecoveryReferral, DomainError } from "../src/modules/arrears/domain.js";

describe("validateRecoveryReferral (GAP-REVENUE-RECOVERY-01)", () => {
  it("allows a referral when there are outstanding arrears", () => {
    expect(() => validateRecoveryReferral(500000n)).not.toThrow();
  });

  it("rejects a referral when nothing is outstanding (no wrongful coercive action)", () => {
    expect(() => validateRecoveryReferral(0n)).toThrow(DomainError);
    expect(() => validateRecoveryReferral(0n)).toThrow(/outstanding arrears/i);
  });

  it("rejects a referral when the balance is negative (overpaid)", () => {
    expect(() => validateRecoveryReferral(-100n)).toThrow(DomainError);
  });
});
