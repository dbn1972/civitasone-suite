/**
 * P0-3: MFA TOTP at-rest secret encryption + RFC-6238 verification.
 *
 * TOTP secrets are sensitive: anyone holding the shared secret can mint valid
 * codes forever. We therefore:
 *   - generate a base32 secret (RFC 4648, no padding) at enrollment,
 *   - store it AES-256-GCM-encrypted at rest, keyed by MFA_ENC_KEY (32-byte key
 *     derived via scrypt), envelope format "mfa:v1:<base64(iv||tag||ct)>",
 *   - verify 6-digit codes per RFC-6238 (HMAC-SHA1, 30s step) with a +/-1 step
 *     window to tolerate clock skew.
 *
 * MFA_ENC_KEY is injected exactly like PII_ENC_KEY (see ecosystem.config.js):
 * env -> on-host key file -> dev fallback; production fails closed.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PREFIX = "mfa:v1:";
const SALT = "civitas-identity-mfa";

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.MFA_ENC_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "MFA_ENC_KEY is required (>=16 chars) for MFA secret encryption at rest. Inject it from the secret manager.",
    );
  }
  cachedKey = scryptSync(secret, Buffer.from(SALT, "utf8"), KEY_LEN);
  return cachedKey;
}

/** Encrypt a base32 TOTP secret -> "mfa:v1:<base64>". */
export function encryptMfaSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored MFA secret envelope -> base32 string. */
export function decryptMfaSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    throw new Error("MFA secret is not in the expected encrypted envelope");
  }
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a random base32 (RFC 4648, no padding) secret. 20 bytes -> 32 chars. */
export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 (RFC 4648) string -> Buffer. Ignores padding/whitespace/case. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[=\s]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 character in MFA secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Compute a RFC-6238 TOTP code for a given counter (time-step). */
function hotp(key: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // 53-bit safe: counter (unix/step) fits well within JS integer range.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export interface TotpOptions {
  stepSeconds?: number;
  digits?: number;
  window?: number;
  now?: number;
}

/** Generate the current TOTP code for a base32 secret (used in tests/tooling). */
export function totpCode(base32Secret: string, opts: TotpOptions = {}): string {
  const stepSeconds = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const now = opts.now ?? Date.now();
  const counter = Math.floor(now / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter, digits);
}

/**
 * Verify a candidate TOTP code against a base32 secret. Constant-time compare,
 * with a +/- `window` step tolerance for clock skew (default 1).
 */
export function verifyTotp(base32Secret: string, code: string, opts: TotpOptions = {}): boolean {
  const stepSeconds = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed) || trimmed.length !== digits) return false;
  const key = base32Decode(base32Secret);
  const counter = Math.floor(now / 1000 / stepSeconds);
  const candidate = Buffer.from(trimmed, "utf8");
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(hotp(key, counter + w, digits), "utf8");
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * SEC H1: verify a candidate TOTP code and return the matched RFC-6238 step
 * (counter) so the caller can enforce single-use (reject any code whose step
 * <= the last accepted step). Returns the matched step, or null if no code in
 * the +/- window matches. Constant-time compare per candidate step.
 */
export function verifyTotpStep(base32Secret: string, code: string, opts: TotpOptions = {}): number | null {
  const stepSeconds = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed) || trimmed.length !== digits) return null;
  const key = base32Decode(base32Secret);
  const counter = Math.floor(now / 1000 / stepSeconds);
  const candidate = Buffer.from(trimmed, "utf8");
  let matched: number | null = null;
  // Iterate the full window (no early return) to keep timing independent of
  // which step matched.
  for (let w = -window; w <= window; w++) {
    const step = counter + w;
    const expected = Buffer.from(hotp(key, step, digits), "utf8");
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      matched = step;
    }
  }
  return matched;
}
