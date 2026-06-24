import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * DPDP Section 4 compliance: derive a one-way HMAC token from Aadhaar (P1-3).
 * Raw Aadhaar is never stored or queued — only the last 4 digits and an
 * HMAC-SHA256 token keyed by AADHAAR_HMAC_KEY. The key is a stable per-deployment
 * secret; we fail closed if it is missing so the service never silently degrades
 * to an unkeyed/guessable digest.
 */

// Resolve the key from the environment first, then fall back to an on-host
// keyfile. The keyfile fallback makes the service resilient to a pm2 restart
// that loses the injected env (the ecosystem env-wiring lives in a shared file
// that a co-tenant process on this box periodically reverts) — without it, a
// restart would fail-closed on every beneficiary write. Resolved once and cached.
let cachedKey: string | null = null;
function resolveAadhaarKey(): string {
  if (cachedKey) return cachedKey;
  const envKey = process.env.AADHAAR_HMAC_KEY;
  if (envKey && envKey.length > 0) {
    cachedKey = envKey;
    return cachedKey;
  }
  const keyfilePath = process.env.AADHAAR_HMAC_KEY_FILE ?? join(homedir(), ".civitasone-grant-aadhaar-hmac-key");
  try {
    const fromFile = readFileSync(keyfilePath, "utf8").trim();
    if (fromFile.length > 0) {
      cachedKey = fromFile;
      return cachedKey;
    }
  } catch {
    // keyfile absent/unreadable — fall through to fail-closed
  }
  throw new Error("CONFIG: AADHAAR_HMAC_KEY not set and keyfile unavailable (DPDP fail-closed)");
}

export function maskAadhaar(rawAadhaar: string): { last4: string; token: string } {
  if (rawAadhaar.length !== 12 || !/^\d{12}$/.test(rawAadhaar)) {
    throw new Error("INVALID_AADHAAR: must be exactly 12 digits");
  }
  const key = resolveAadhaarKey();
  const last4 = rawAadhaar.slice(-4);
  const token = createHmac("sha256", key).update(rawAadhaar).digest("hex");
  return { last4, token };
}
