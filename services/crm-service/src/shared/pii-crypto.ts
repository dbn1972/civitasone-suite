/**
 * crm-service: Field-level PII encryption at rest (DPDP / P1-2).
 *
 * App-layer AES-256-GCM envelope for contact email & phone. Mirrors
 * hrms-service/src/shared/pii-crypto.ts (same wire format & key-derivation),
 * but keyed from CRM_PII_KEY and adds a deterministic BLIND INDEX (keyed
 * HMAC-SHA256) so the per-tenant unique-email constraint and bulk-import
 * de-duplication keep working while the email column itself is ciphertext.
 *
 * Ciphertext wire format (single text value):
 *   v2: "enc:v2:<keyid>:" + base64( 12B IV || 16B GCM tag || ct )
 *
 * Fail-closed: in production a missing/short CRM_PII_KEY throws at first use.
 * NO secret literal lives in source — the key is injected via env
 * (ecosystem.config.js -> CRM_PII_KEY, read from env or on-host key file).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

const PREFIX_V2 = "enc:v2:";
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

// Fixed fallback salt (used only when CRM_PII_SALT is unset). Configuring
// CRM_PII_SALT is the better posture; the master secret is already high-entropy.
const DEFAULT_SALT = "civitas-crm-pii";

export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiiDecryptError";
  }
}

function readMasterSecret(): string {
  const secret = process.env.CRM_PII_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CRM_PII_KEY is required (>=16 chars) for at-rest PII encryption. Inject it from the secret manager.",
    );
  }
  return secret;
}

function saltBuf(): Buffer {
  const s = process.env.CRM_PII_SALT;
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
  const activeKeyId = process.env.CRM_PII_KEY_ID && process.env.CRM_PII_KEY_ID.length > 0
    ? process.env.CRM_PII_KEY_ID
    : "k1";

  const v2 = new Map<string, Buffer>();
  v2.set(activeKeyId, deriveV2Key(secret));

  const raw = process.env.CRM_PII_KEYRING;
  if (raw && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`CRM_PII_KEYRING is not valid JSON: ${String(e)}`);
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
 * Deterministic blind index for email: keyed HMAC over the normalized
 * (trimmed + lowercased) value. Stored in a separate column so the
 * per-tenant unique constraint + onConflict de-dup work over ciphertext.
 */
export function blindIndex(plain: string): string {
  const ring = keyring();
  const norm = plain.trim().toLowerCase();
  return createHmac("sha256", ring.indexKey).update(norm, "utf8").digest("hex");
}

/**
 * Mask a cleartext email/phone for non-admin reads/exports.
 * email: keep first char + domain  ->  r***@techcorp.in
 * phone: keep last 4               ->  ******1111
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
 * Pre-warm the AES-GCM cipher path: initializes cached key material (scrypt
 * derivation) and JIT-compiles the encrypt code path with a throwaway call.
 * Safe to call multiple times (idempotent — keyring is cached after first call).
 */
export function warmCipher(): void {
  keyring();
  encryptPii("warmup");
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
