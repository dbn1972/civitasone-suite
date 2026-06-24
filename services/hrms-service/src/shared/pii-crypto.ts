/**
 * P0-1 (DPDP): Field-level PII encryption at rest.
 *
 * App-layer AES-256-GCM envelope, integrated into Drizzle as a `customType`.
 * Every read transparently decrypts and every write transparently encrypts, so
 * all existing call sites (repo, internal payroll-input projection, pension,
 * ai-fraud, self-service, reports, …) keep seeing CLEARTEXT while the column at
 * rest holds CIPHERTEXT.
 *
 * Ciphertext wire format (stored as a single text value):
 *   "enc:v1:" + base64( 12-byte IV || 16-byte GCM tag || ciphertext )
 *
 * The 32-byte key is derived (SHA-256) from the env secret PII_ENC_KEY so any
 * sufficiently-long secret works. Rotating the secret re-derives a new key.
 *
 * Backward / forward compatibility: `fromDriver` passes through any value that
 * does NOT carry the "enc:v1:" prefix (i.e. legacy plaintext written before the
 * backfill, or a NULL). This makes the cut-over safe and the backfill idempotent.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX = "enc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.PII_ENC_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "PII_ENC_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  cachedKey = createHash("sha256").update(secret, "utf8").digest();
  return cachedKey;
}

/** Encrypt a UTF-8 string -> "enc:v1:<base64>". */
export function encryptPii(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** True if a stored value is in our ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Decrypt "enc:v1:<base64>" -> UTF-8 string. Pass through legacy plaintext. */
export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext / not yet backfilled
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Drizzle custom column type: a `text` column whose application value is the
 * cleartext string, encrypted on write and decrypted on read.
 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    return encryptPii(value);
  },
  fromDriver(value: string): string {
    return decryptPii(value);
  },
});
