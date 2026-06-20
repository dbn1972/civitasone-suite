import { createHash } from "node:crypto";

/**
 * DPDP Section 4 compliance: derive a one-way token from Aadhaar.
 * Raw Aadhaar is never stored — only last 4 digits and the SHA-256 HMAC token.
 * The salt must be a stable per-deployment secret (AADHAAR_SALT env).
 */
export function maskAadhaar(rawAadhaar: string): { last4: string; token: string } {
  if (rawAadhaar.length !== 12 || !/^\d{12}$/.test(rawAadhaar)) {
    throw new Error("INVALID_AADHAAR: must be exactly 12 digits");
  }
  const salt = process.env.AADHAAR_SALT;
  if (!salt) throw new Error("CONFIG: AADHAAR_SALT not set");
  const last4 = rawAadhaar.slice(-4);
  const token = createHash("sha256").update(`${rawAadhaar}:${salt}`).digest("hex");
  return { last4, token };
}
