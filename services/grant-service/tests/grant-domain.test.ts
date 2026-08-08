/**
 * Grant Service — disbursement domain tests. 8 packs.
 */
import { describe, it, expect } from "vitest";
import { assertDisbursementWithinApproved, canRetryDisbursement, MAX_DISBURSEMENT_RETRIES } from "../src/modules/disbursement/domain.js";

describe("disbursement guards", () => {
  it("passes when within approved amount", () => expect(() => assertDisbursementWithinApproved(1_000_000n, 300_000n, 500_000n)).not.toThrow());
  it("passes at exactly approved", () => expect(() => assertDisbursementWithinApproved(1_000_000n, 500_000n, 500_000n)).not.toThrow());
  it("throws when exceeds approved", () => expect(() => assertDisbursementWithinApproved(1_000_000n, 500_000n, 500_001n)).toThrow());
  it("canRetryDisbursement: within max", () => expect(canRetryDisbursement(2)).toBe(true));
  it("canRetryDisbursement: at max = no", () => expect(canRetryDisbursement(3)).toBe(false));
  it("MAX_DISBURSEMENT_RETRIES = 3", () => expect(MAX_DISBURSEMENT_RETRIES).toBe(3));
});
