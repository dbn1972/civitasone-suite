/**
 * visitor-service: Field-level PII encryption at rest (DPDP / Requirement 18.2).
 *
 * App-layer AES-256-GCM envelope for visitor PII (name, phone, email, aadhaar,
 * photo_ref, address). Mirrors crm-service/src/shared/pii-crypto.ts and
 * telephony-service/src/shared/pii-crypto.ts (same wire format & key
 * derivation), but keyed from VISITOR_PII_KEY. Also exposes a deterministic
 * BLIND INDEX (keyed HMAC-SHA256) so blacklist/watchlist identity-document
 * lookups (migration 0003's `identity_doc_hash` columns) and de-duplication
 * keep working while the underlying PII columns are ciphertext.
 *
 * Ciphertext wire format (single text value):
 *   v2: "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ct )
 *
 * Fail-closed: a missing/short VISITOR_PII_KEY throws at first use (module
 * load, via assertPiiKeyConfigured() called from app.ts/worker.ts, or lazily
 * on first encrypt/decrypt). NO secret literal lives in source — the key is
 * injected via env (ecosystem.config.js -> VISITOR_PII_KEY, read from env or
 * an on-host key file / secret manager).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

// Fixed fallback salt (used only when VISITOR_PII_SALT is unset). Configuring
// VISITOR_PII_SALT is the better posture; the master secret is already
// high-entropy so the fixed salt is an acceptable fallback for cut-over.
const DEFAULT_SALT = "civitas-visitor-pii";

/** Typed, non-500 error for any decrypt failure (tamper, wrong key, corruption). */
export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

function readMasterSecret(): string {
  const secret = process.env.VISITOR_PII_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "VISITOR_PII_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.VISITOR_PII_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

/** scrypt KDF -> 32-byte AES key for a v2 key id. */
function deriveV2Key(secret: string): Buffer {
  return scryptSync(secret, saltBuf(), KEY_LEN);
}

interface Keyring {
  activeKeyId: string;
  v2: Map<string, Buffer>; // keyid -> 32-byte key
  indexKey: Buffer; // domain-separated HMAC key for blind indexing
}

let cachedRing: Keyring | null = null;

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = readMasterSecret();
  const activeKeyId =
    process.env.VISITOR_PII_KEY_ID && process.env.VISITOR_PII_KEY_ID.length > 0
      ? process.env.VISITOR_PII_KEY_ID
      : "k1";

  const v2 = new Map<string, Buffer>();
  // Active key derived from the master secret.
  v2.set(activeKeyId, deriveV2Key(secret));

  // Optional retired keys for post-rotation reads.
  const raw = process.env.VISITOR_PII_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`VISITOR_PII_KEYRING is not valid JSON: ${String(e)}`);
    }
    if (parsed && typeof parsed === "object") {
      for (const [kid, kSecret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof kSecret === "string" && kSecret.length >= 16 && !v2.has(kid)) {
          v2.set(kid, deriveV2Key(kSecret));
        }
      }
    }
  }

  // Blind-index HMAC key, domain-separated from the encryption key.
  const indexKey = scryptSync(secret, Buffer.concat([saltBuf(), Buffer.from(":blind-index")]), KEY_LEN);

  cachedRing = { activeKeyId, v2, indexKey };
  return cachedRing;
}

/** Test/maintenance hook: drop the cached keyring (e.g. after env change). */
export function resetPiiKeyCache(): void {
  cachedRing = null;
}

/**
 * Fail-fast PII key validation. Eagerly builds the keyring so a missing or
 * too-short VISITOR_PII_KEY throws at boot (fail-closed) instead of letting
 * the service start green and silently fail-open. Call from app.ts/worker.ts.
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

/** True if a stored value is in our ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V2);
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
 * Decrypt an envelope -> UTF-8 string. Pass through legacy plaintext (NULL or
 * a value written before the backfill).
 * Throws PiiDecryptError (fail closed) on tamper / wrong key / corruption.
 */
export function decryptPii(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext / not yet backfilled
  const ring = keyring();
  try {
    const rest = stored.slice(PREFIX_V2.length);
    const sep = rest.indexOf(":");
    if (sep < 0) throw new PiiDecryptError("malformed enc:v2 envelope (missing key id)");
    const keyId = rest.slice(0, sep);
    const k = ring.v2.get(keyId);
    if (!k) throw new PiiDecryptError(`no PII key for key id "${keyId}" (rotation/keyring gap)`);
    return gcmDecrypt(k, Buffer.from(rest.slice(sep + 1), "base64"));
  } catch (e) {
    if (e instanceof PiiDecryptError) throw e;
    throw new PiiDecryptError("PII decryption failed (tampered or wrong key)", { cause: e });
  }
}

/**
 * Deterministic blind index: keyed HMAC over the normalized (trimmed +
 * lowercased) value. Used for identity-document hashes (blacklist/watchlist
 * `identity_doc_hash` columns per migration 0003) and other exact-match
 * lookups/de-dup that must work without decrypting the PII column.
 */
export function blindIndex(plain: string): string {
  const ring = keyring();
  const norm = plain.trim().toLowerCase();
  return createHmac("sha256", ring.indexKey).update(norm, "utf8").digest("hex");
}

/** Normalize a phone number to digits + leading "+" for consistent blind indexing. */
export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

/**
 * Mask a cleartext email for non-admin reads/exports: keep first char + domain
 * -> r***@example.gov.in
 */
export function maskEmail(value: string | null): string | null {
  if (!value) return value;
  const at = value.indexOf("@");
  if (at <= 0) return maskGeneric(value);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const head = local.slice(0, 1);
  return `${head}***${domain}`;
}

/** Mask a cleartext phone number for non-admin reads/exports: keep last 4 digits. */
export function maskPhone(value: string | null): string | null {
  if (!value) return value;
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function maskGeneric(value: string): string {
  if (value.length <= 2) return "**";
  return `${value.slice(0, 1)}***`;
}

export function safeTimingEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
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
