/**
 * DEF-RC-003 — OTP verification domain (pure).
 */
import { describe, it, expect } from "vitest";
import {
  generateOtp, verifyOtp, submissionRequiresVerification, otpVerificationEnabled,
  OTP_LENGTH, MAX_ATTEMPTS,
} from "../src/modules/recruitment/otp-verify.js";

describe("generateOtp", () => {
  it("produces a 6-digit numeric string", () => {
    const code = generateOtp(Buffer.alloc.bind(Buffer, 4, 0xab));
    expect(code).toHaveLength(OTP_LENGTH);
    expect(/^\d{6}$/.test(code)).toBe(true);
  });
  it("pads short numbers with leading zeros", () => {
    const buf = Buffer.alloc(4); buf.writeUInt32BE(42, 0);
    const code = generateOtp(() => buf);
    expect(code).toBe("000042");
  });
});

describe("verifyOtp", () => {
  const now = Date.now();
  const challenge = { code: "123456", expiresAt: new Date(now + 60_000), attempts: 0, verified: false };

  it("accepts a correct code within TTL", () => {
    expect(verifyOtp(challenge, "123456", now).valid).toBe(true);
  });
  it("rejects a wrong code", () => {
    expect(verifyOtp(challenge, "000000", now)).toMatchObject({ valid: false, reason: "invalid_code" });
  });
  it("rejects after max attempts", () => {
    expect(verifyOtp({ ...challenge, attempts: MAX_ATTEMPTS }, "123456", now)).toMatchObject({ valid: false, reason: "max_attempts_exceeded" });
  });
  it("rejects an expired challenge", () => {
    expect(verifyOtp(challenge, "123456", now + 120_000)).toMatchObject({ valid: false, reason: "expired" });
  });
  it("rejects an already-verified challenge", () => {
    expect(verifyOtp({ ...challenge, verified: true }, "123456", now)).toMatchObject({ valid: false, reason: "already_verified" });
  });
});

describe("submissionRequiresVerification", () => {
  it("blocks when enabled + email NOT verified", () => {
    expect(submissionRequiresVerification(true, false)).toBe(true);
  });
  it("allows when disabled (regardless of email state)", () => {
    expect(submissionRequiresVerification(false, false)).toBe(false);
  });
  it("allows when enabled + email IS verified", () => {
    expect(submissionRequiresVerification(true, true)).toBe(false);
  });
});

describe("otpVerificationEnabled", () => {
  it("defaults off", () => {
    expect(otpVerificationEnabled({})).toBe(false);
    expect(otpVerificationEnabled({ FEATURE_OTP_VERIFICATION_ENABLED: "true" })).toBe(true);
  });
});
