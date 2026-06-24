/**
 * P0-1 (DPDP): Field-level PII encryption at rest.
 *
 * App-layer AES-256-GCM envelope, integrated into Drizzle as a `customType`.
 * Every read transparently decrypts and every write transparently encrypts, so
 * all existing call sites (repo, internal payroll-input projection, pension,
 * ai-fraud, self-service, reports, …) keep seeing CLEARTEXT while the column at
 * rest holds CIPHERTEXT.
 *
 * Ciphertext wire formats (stored as a single text value):
 *   v1 (legacy):  "enc:v1:"            + base64( 12B IV || 16B GCM tag || ct )
 *   v2 (current): "enc:v2:<keyid>:"    + base64( 12B IV || 16B GCM tag || ct )
 *
 * KEYRING / ROTATION SAFETY (M1+M2):
 *   - Each key has a string KEY ID and a 32-byte AES key.
 *   - v2 envelopes embed the key id, so old ciphertext stays decryptable after
 *     CITIZEN_PII_KEY rotation: decrypt looks the key id up in the keyring.
 *   - v1 envelopes carry NO key id; they are decrypted with a dedicated v1 key
 *     derived exactly as the original code did — unsalted SHA-256(CITIZEN_PII_KEY) —
 *     so EXISTING enc:v1 rows keep decrypting unchanged. (This requires the
 *     CURRENT CITIZEN_PII_KEY to be the one that wrote those rows; that is exactly
 *     the production secret we preserve across deploys.)
 *
 * KEY DERIVATION (M1):
 *   - v2 keys are derived with scrypt (a real KDF) over CITIZEN_PII_KEY + a salt.
 *   - The salt is read from CITIZEN_PII_SALT when configured (recommended); a fixed,
 *     documented application salt is used as a fallback so the cut-over needs no
 *     new env var. The fixed salt is acceptable because the master secret is
 *     already high-entropy; configuring CITIZEN_PII_SALT is the better posture.
 *
 * KEYRING CONFIG (rotation):
 *   - The active write key id defaults to "k1" (override with CITIZEN_PII_KEY_ID).
 *   - Additional retired keys may be supplied via CITIZEN_PII_KEYRING as a JSON
 *     object { "<keyid>": "<secret>", ... }; each is scrypt-derived with the
 *     same salt so its ciphertext remains decryptable after the master rotates.
 *
 * Backward / forward compatibility: `fromDriver` passes through any value that
 * does NOT carry an "enc:" prefix (legacy plaintext written before the backfill,
 * or NULL). This keeps the cut-over safe and the backfill idempotent.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V1 = "enc:v1:";
const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

// Fixed, documented fallback salt (used only when CITIZEN_PII_SALT is unset). 16
// bytes, ASCII. Configuring CITIZEN_PII_SALT is preferred.
const DEFAULT_SALT = "civitas-citizen-pii";

/** Typed, non-500 error for any decrypt failure (tamper, wrong key, corruption). */
export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

function readMasterSecret(): string {
  const secret = process.env.CITIZEN_PII_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CITIZEN_PII_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.CITIZEN_PII_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

/** scrypt KDF -> 32-byte AES key for a v2 key id. */
function deriveV2Key(secret: string): Buffer {
  return scryptSync(secret, saltBuf(), KEY_LEN);
}

/** Legacy v1 key: unsalted SHA-256(secret) — unchanged so old rows decrypt. */
function deriveV1Key(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

interface Keyring {
  activeKeyId: string;
  v2: Map<string, Buffer>; // keyid -> 32-byte key
  v1: Buffer; // legacy unsalted key for prefix enc:v1:
}

let cachedRing: Keyring | null = null;

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = readMasterSecret();
  const activeKeyId = process.env.CITIZEN_PII_KEY_ID && process.env.CITIZEN_PII_KEY_ID.length > 0
    ? process.env.CITIZEN_PII_KEY_ID
    : "k1";

  const v2 = new Map<string, Buffer>();
  // Active key derived from the master secret.
  v2.set(activeKeyId, deriveV2Key(secret));

  // Optional retired keys for post-rotation reads.
  const raw = process.env.CITIZEN_PII_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`CITIZEN_PII_KEYRING is not valid JSON: ${String(e)}`);
    }
    if (parsed && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !v2.has(kid)) {
          v2.set(kid, deriveV2Key(kSecret));
        }
      }
    }
  }

  cachedRing = { activeKeyId, v2, v1: deriveV1Key(secret) };
  return cachedRing;
}

/** Test/maintenance hook: drop the cached keyring (e.g. after env change). */
export function resetPiiKeyCache(): void {
  cachedRing = null;
}

/**
 * P0-6: fail-fast PII key validation. Eagerly builds the keyring so a missing or
 * too-short CITIZEN_PII_KEY throws at boot (fail-closed) instead of letting the
 * service start green and silently fail-open. Call from buildApp() and worker.ts.
 */
export function assertPiiKeyConfigured(): void {
  keyring();
}

/** Encrypt a UTF-8 string -> "enc:v2:<keyid>:<base64>" using the active key. */
export function encryptPii(plain: string): string {
  const ring = keyring();
  const k = ring.v2.get(ring.activeKeyId);
  if (!k) throw new Error("active PII key missing from keyring");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ct]).toString("base64");
  return `${PREFIX_V2}${ring.activeKeyId}:${payload}`;
}

/** True if a stored value is in any of our ciphertext envelopes. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2);
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
 * Decrypt an envelope -> UTF-8 string. Pass through legacy plaintext.
 * Throws PiiDecryptError (fail closed) on tamper / wrong key / corruption.
 */
export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext / not yet backfilled
  const ring = keyring();

  try {
    if (stored.startsWith(PREFIX_V2)) {
      const rest = stored.slice(PREFIX_V2.length);
      const sep = rest.indexOf(":");
      if (sep < 0) throw new PiiDecryptError("malformed enc:v2 envelope (missing key id)");
      const keyId = rest.slice(0, sep);
      const k = ring.v2.get(keyId);
      if (!k) throw new PiiDecryptError(`no PII key for key id "${keyId}" (rotation/keyring gap)`);
      return gcmDecrypt(k, Buffer.from(rest.slice(sep + 1), "base64"));
    }
    // v1: legacy unsalted key, no embedded key id.
    return gcmDecrypt(ring.v1, Buffer.from(stored.slice(PREFIX_V1.length), "base64"));
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed (tampered or wrong key)", { cause: e });
  }
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
