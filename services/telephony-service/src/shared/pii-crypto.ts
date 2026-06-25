/**
 * telephony-service: field-level PII encryption at rest (DPDP / P1-2).
 *
 * Caller/callee phone numbers are PII. This is an app-layer AES-256-GCM envelope
 * for those columns, mirroring crm-service/src/shared/pii-crypto.ts (same wire
 * format + key-derivation) but keyed from TELEPHONY_PII_KEY. It adds a
 * deterministic keyed BLIND INDEX (HMAC-SHA256) so "find every call from this
 * number" lookups and de-duplication keep working while the number column
 * itself is ciphertext.
 *
 * Ciphertext wire format (single text value):
 *   v2: "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ct )
 *
 * Fail-closed: a missing/short TELEPHONY_PII_KEY throws at first use. NO secret
 * literal lives in source — the key is injected via env (ecosystem.config.js ->
 * TELEPHONY_PII_KEY, read from env or an on-host key file).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

// Fixed fallback salt (used only when TELEPHONY_PII_SALT is unset). Configuring
// TELEPHONY_PII_SALT is the better posture; the master secret is high-entropy.
const DEFAULT_SALT = "civitas-telephony-pii";

export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

function readMasterSecret(): string {
  const secret = process.env.TELEPHONY_PII_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "TELEPHONY_PII_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.TELEPHONY_PII_SALT;
  return Buffer.from(s && s.length > 0 ? s : DEFAULT_SALT, "utf8");
}

function deriveV2Key(secret: string): Buffer {
  return scryptSync(secret, saltBuf(), KEY_LEN);
}

interface Keyring {
  activeKeyId: string;
  v2: Map<string, Buffer>;
  indexKey: Buffer;
}

let cachedRing: Keyring | null = null;

function keyring(): Keyring {
  if (cachedRing) return cachedRing;
  const secret = readMasterSecret();
  const activeKeyId =
    process.env.TELEPHONY_PII_KEY_ID && process.env.TELEPHONY_PII_KEY_ID.length > 0
      ? process.env.TELEPHONY_PII_KEY_ID
      : "k1";

  const v2 = new Map<string, Buffer>();
  v2.set(activeKeyId, deriveV2Key(secret));

  const raw = process.env.TELEPHONY_PII_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`TELEPHONY_PII_KEYRING is not valid JSON: ${String(e)}`);
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

export function resetPiiKeyCache(): void {
  cachedRing = null;
}

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
 * Deterministic blind index for a phone number: keyed HMAC over the normalized
 * (digits-only) value. Stored in a separate column so "all calls from this
 * number" lookups work over ciphertext without ever decrypting the column.
 */
export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

export function blindIndex(plain: string): string {
  const ring = keyring();
  const norm = normalizePhone(plain);
  return createHmac("sha256", ring.indexKey).update(norm, "utf8").digest("hex");
}

/**
 * Mask a cleartext phone number for non-admin reads/exports.
 * Keep the last 4 digits:  9876543210 -> ******3210
 */
export function maskPhone(value: string | null): string | null {
  if (!value) return value;
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function safeTimingEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Drizzle custom column type: cleartext in app, AES-256-GCM ciphertext at rest.
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
