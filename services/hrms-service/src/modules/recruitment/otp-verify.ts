/**
 * OTP verification for public application submission (DEF-RC-003 / R-RA-0077) — pure.
 *
 * Before a candidate profile may be submitted, their email (and optionally mobile)
 * must be verified via a one-time code. OTP generation/delivery is an EXTERNAL
 * seam (SMS/email gateway) gated by FEATURE_OTP_VERIFICATION_ENABLED. Until wired
 * the trigger returns an honest 501 and submission does NOT gate on verification.
 *
 * The OTP is a 6-digit numeric code, valid for 10 minutes (configurable). This
 * module holds the stateless validation rules; state (code, expiry, attempts)
 * lives in the DB (hrms_otp_challenges). No I/O here.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 600; // 10 minutes
export const MAX_ATTEMPTS = 5;

/** Feature flag: when off, OTP is not required for submission. */
export function otpVerificationEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_OTP_VERIFICATION_ENABLED === "true";
}

/** Generate a cryptographically random numeric OTP of OTP_LENGTH digits. */
export function generateOtp(randomBytes: (n: number) => Buffer): string {
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % (10 ** OTP_LENGTH);
  return String(num).padStart(OTP_LENGTH, "0");
}

export interface OtpChallenge {
  code: string;
  expiresAt: Date;
  attempts: number;
  verified: boolean;
}

/** Validate a candidate-supplied code against a challenge. Pure logic. */
export function verifyOtp(challenge: OtpChallenge, code: string, nowMs: number): { valid: boolean; reason?: string } {
  if (challenge.verified) return { valid: false, reason: "already_verified" };
  if (challenge.attempts >= MAX_ATTEMPTS) return { valid: false, reason: "max_attempts_exceeded" };
  if (nowMs > challenge.expiresAt.getTime()) return { valid: false, reason: "expired" };
  if (challenge.code !== code) return { valid: false, reason: "invalid_code" };
  return { valid: true };
}

/** Whether submission should be blocked for a candidate whose email is unverified. */
export function submissionRequiresVerification(enabled: boolean, emailVerified: boolean): boolean {
  return enabled && !emailVerified;
}
