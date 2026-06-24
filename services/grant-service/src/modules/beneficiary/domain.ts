import { createHmac } from "node:crypto";

/**
 * DPDP Section 4 compliance: derive a one-way HMAC token from Aadhaar (P1-3).
 * Raw Aadhaar is never stored or queued — only the last 4 digits and an
 * HMAC-SHA256 token keyed by AADHAAR_HMAC_KEY. The key is a stable per-deployment
 * secret injected from the secret manager; we fail closed if it is missing so the
 * service never silently degrades to an unkeyed/guessable digest.
 */
export function maskAadhaar(rawAadhaar: string): { last4: string; token: string } {
  if (rawAadhaar.length !== 12 || !/^\d{12}$/.test(rawAadhaar)) {
    throw new Error("INVALID_AADHAAR: must be exactly 12 digits");
  }
  const key = process.env.AADHAAR_HMAC_KEY;
  if (!key || key.length === 0) {
    throw new Error("CONFIG: AADHAAR_HMAC_KEY not set (DPDP fail-closed)");
  }
  const last4 = rawAadhaar.slice(-4);
  const token = createHmac("sha256", key).update(rawAadhaar).digest("hex");
  return { last4, token };
}
