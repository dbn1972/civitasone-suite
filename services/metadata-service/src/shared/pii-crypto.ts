/**
 * metadata-service: field-level PII encryption at rest (DPDP Act 2023).
 *
 * WHY this exists here: LM-002 adds a **public, unauthenticated** web-form lead
 * capture endpoint. It collects a lead's name, email and phone — the three
 * columns the security posture names explicitly as `encryptedText()` columns —
 * plus the free-form answers the tenant's form asks for, which for a lead form
 * are very likely to be personal data too. All of it is stored as an
 * AES-256-GCM envelope so a database dump is not a DPDP breach.
 *
 * Wire format (identical to crm-/visitor-/telephony-service so a future
 * cross-service backfill can read it):
 *   "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ciphertext )
 *
 * Key material comes from `METADATA_PII_KEY` (>= 16 chars) and is never logged.
 * There is NO plaintext fallback on write: if the key is absent, encryption
 * throws and the write fails closed. Reads pass through values that are not in
 * the envelope format so pre-encryption rows (there are none today) stay
 * readable.
 *
 * The keyring is built lazily on first use rather than at module load, so
 * importing the schema (which every route and test does) does not require the
 * key. `assertPiiKeyConfigured()` is called from app.ts and fails the boot in
 * production only — matching `assertInternalServiceSecret()` in @civitasone/auth
 * so local dev and tests are unaffected by a missing key while production
 * cannot start mis-configured.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

/** Used only when METADATA_PII_SALT is unset; the master secret is already high-entropy. */
const DEFAULT_SALT = "civitas-metadata-pii";

/** Typed, non-500-shaped error for any decrypt failure (tamper, wrong key, corruption). */
export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

interface Keyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

let cachedRing: Keyring | null = null;

function readMasterSecret(): string {
  const secret = process.env.METADATA_PII_KEY;
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error(
      "METADATA_PII_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.METADATA_PII_SALT;
  return Buffer.from(s !== undefined && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, saltBuf(), KEY_LEN);
}

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = readMasterSecret();
  const envKeyId = process.env.METADATA_PII_KEY_ID;
  const activeKeyId = envKeyId !== undefined && envKeyId.length > 0 ? envKeyId : "k1";

  const keys = new Map<string, Buffer>();
  keys.set(activeKeyId, deriveKey(secret));

  // Optional retired keys so reads still work after a rotation.
  const raw = process.env.METADATA_PII_KEYRING;
  if (raw !== undefined && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`METADATA_PII_KEYRING is not valid JSON: ${String(e)}`);
    }
    if (parsed !== null && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !keys.has(kid)) {
          keys.set(kid, deriveKey(kSecret));
        }
      }
    }
  }

  cachedRing = { activeKeyId, keys };
  return cachedRing;
}

/** Test/maintenance hook: drop the cached keyring (e.g. after an env change). */
export function resetPiiKeyCache(): void {
  cachedRing = null;
}

/**
 * Fail-fast key validation. Throws in production if METADATA_PII_KEY is missing
 * or too short; a no-op outside production so dev/test boots without the key.
 */
export function assertPiiKeyConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  keyring();
}

/** True if a stored value already carries our ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V2);
}

/** Encrypt a UTF-8 string with the active key. Throws if no key is configured. */
export function encryptPii(plain: string): string {
  const ring = keyring();
  const k = ring.keys.get(ring.activeKeyId);
  if (!k) throw new Error("active PII key missing from keyring");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
  return `${PREFIX_V2}${ring.activeKeyId}:${payload}`;
}

function gcmDecrypt(k: Buffer, raw: Buffer): string {
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Decrypt an envelope back to cleartext. Values without the envelope prefix are
 * returned unchanged (legacy / not-yet-backfilled rows). Fails closed with
 * PiiDecryptError on tamper, wrong key or corruption — never returns garbage.
 */
export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const ring = keyring();
  try {
    const rest = stored.slice(PREFIX_V2.length);
    const sep = rest.indexOf(":");
    if (sep < 0) throw new PiiDecryptError("malformed enc:v2 envelope (missing key id)");
    const keyId = rest.slice(0, sep);
    const k = ring.keys.get(keyId);
    if (!k) throw new PiiDecryptError(`no PII key for key id "${keyId}" (rotation/keyring gap)`);
    return gcmDecrypt(k, Buffer.from(rest.slice(sep + 1), "base64"));
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed (tampered or wrong key)", { cause: e });
  }
}

/** Mask an email for non-privileged reads/exports: r***@example.gov.in */
export function maskEmail(value: string | null): string | null {
  if (value === null || value === "") return value;
  const at = value.indexOf("@");
  if (at <= 0) return value.length <= 2 ? "**" : `${value.slice(0, 1)}***`;
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

/** Mask a phone number for non-privileged reads/exports: keep the last 4 digits. */
export function maskPhone(value: string | null): string | null {
  if (value === null || value === "") return value;
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
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
